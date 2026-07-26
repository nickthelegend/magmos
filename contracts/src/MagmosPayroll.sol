// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMagmosRegistry} from "./interfaces/IMagmosRegistry.sol";

/// @title MagmosPayroll
/// @notice Per-second streaming payroll on Arc. An organization creates one pool per ERC-20
///         token, funds it, and streams to recipients continuously. Recipients claim accrued
///         pay at any time. Streams can be paused, resumed, or stopped.
/// @dev Solidity port of `sweem_core::stream_pool`. Key translations from the Sui/Move original:
///      - time is measured in SECONDS (`block.timestamp`) instead of milliseconds;
///      - custody is an ERC-20 balance held by this contract (SafeERC20) instead of `Balance<T>`;
///      - one `StreamPool<T>` shared object becomes one entry in `_pools[poolId]`, with
///        `poolId = keccak256(org, token)` — one pool per (org, token);
///      - the `Table<address, Stream>` becomes a mapping plus enumerable index arrays so the
///        frontend can read every stream without an off-chain event indexer.
///      Streaming math, crystallization-on-rate-change, the min-claim floor, and the deposit-fee
///      split are preserved exactly.
contract MagmosPayroll is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IMagmosRegistry public immutable registry;

    uint256 public constant WEEK = 604_800; // seconds
    // Anti-dust floor: a claim must be at least this much (unless crystallized pendingBalance
    // exists). A small absolute amount (0.01 USDC) so freshly-started streams become claimable
    // within seconds rather than after ~16h (the old 10%-of-weekly floor).
    uint256 public constant MIN_CLAIM_AMOUNT = 10_000; // 0.01 USDC (6 dp)
    uint256 public constant BPS_DENOM = 10_000;
    /// @notice Role bit allowing an account to pause/resume streams on a pool.
    uint8 public constant PAUSER_ROLE = 0x01;

    struct Stream {
        uint256 rateAmount; // raw token units earned per `ratePeriod`
        uint256 ratePeriod; // seconds
        uint256 pendingBalance; // crystallized earned-but-unclaimed (survives rate changes)
        uint64 startedAt;
        uint64 claimedAt; // last settlement timestamp
        uint64 totalPausedSecs; // paused time accumulated within the current settlement window
        uint64 pausedAt; // 0 = active
        uint64 stoppedAt; // 0 = not stopped
        bool exists;
    }

    struct Pool {
        address org;
        address token;
        uint256 totalDeposited; // net of deposit fees
        uint256 totalClaimed;
        uint256 balance; // claimable liquidity currently held for this pool
        bool exists;
    }

    /// @notice Deployer, permitted to wire the advance module exactly once (see setAdvanceModule).
    address public immutable deployer;
    /// @notice The only contract allowed to settle earned-wage advances against streams.
    /// @dev Zero until wired; settable once and never again, so a later key compromise cannot
    ///      redirect recipient funds through a malicious module.
    address public advanceModule;
    bool private _advanceModuleSet;

    mapping(bytes32 poolId => Pool) private _pools;
    mapping(bytes32 poolId => mapping(address employee => Stream)) private _streams;
    mapping(bytes32 poolId => mapping(address account => uint8 roleBits)) private _delegatedRoles;
    mapping(bytes32 poolId => address[] employees) private _employeeList;

    // Discovery indexes (Sui discovered these via event queries; on EVM we keep them enumerable).
    mapping(address org => bytes32[] poolIds) private _orgPools;
    mapping(address employee => bytes32[] poolIds) private _employeePools;

    event PoolCreated(bytes32 indexed poolId, address indexed org, address indexed token);
    event PoolFunded(
        bytes32 indexed poolId,
        address indexed org,
        uint256 gross,
        uint256 fee,
        uint256 net,
        uint256 timestamp
    );
    event PoolToppedUp(
        bytes32 indexed poolId, address indexed org, uint256 gross, uint256 fee, uint256 net
    );
    event StreamCreated(
        bytes32 indexed poolId,
        address indexed employee,
        uint256 rateAmount,
        uint256 ratePeriod,
        uint64 startedAt
    );
    event FundsClaimed(
        bytes32 indexed poolId, address indexed employee, uint256 amount, uint256 timestamp
    );
    event StreamPaused(bytes32 indexed poolId, address indexed employee, uint256 pausedAt);
    event StreamResumed(bytes32 indexed poolId, address indexed employee, uint256 resumedAt);
    event StreamStopped(bytes32 indexed poolId, address indexed employee, uint256 stoppedAt);
    event PoolRoleGranted(bytes32 indexed poolId, address indexed account, uint8 role);
    event PoolRoleRevoked(bytes32 indexed poolId, address indexed account, uint8 role);
    event AdvanceModuleSet(address indexed module);
    /// @notice A portion of accrued pay was settled early (earned-wage advance) to `to`.
    event AdvanceSettled(
        bytes32 indexed poolId,
        address indexed employee,
        uint256 amount,
        address indexed to,
        uint256 remainingClaimable,
        uint256 timestamp
    );

    error NotOrg();
    error PoolNotFound();
    error PoolAlreadyExists();
    error StreamNotFound();
    error StreamAlreadyStopped();
    error StreamNotPaused();
    error StreamNotActive();
    error InsufficientPoolBalance();
    error ZeroClaimable();
    error ArrayMismatch();
    error BelowMinClaim();
    error InvalidRatePeriod();
    error NotAuthorized();
    error ZeroAddress();
    error NotAdvanceModule();
    error AdvanceModuleAlreadySet();
    error ExceedsClaimable();

    constructor(address registry_) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = IMagmosRegistry(registry_);
        deployer = msg.sender;
    }

    /// @notice Wire the earned-wage-advance module. Callable once, by the deployer, forever.
    function setAdvanceModule(address module) external {
        if (msg.sender != deployer) revert NotAuthorized();
        if (_advanceModuleSet) revert AdvanceModuleAlreadySet();
        if (module == address(0)) revert ZeroAddress();
        _advanceModuleSet = true;
        advanceModule = module;
        emit AdvanceModuleSet(module);
    }

    /// @notice Deterministic pool id for an (org, token) pair.
    function poolIdFor(address org, address token) public pure returns (bytes32) {
        return keccak256(abi.encode(org, token));
    }

    // ------------------------------------------------------------------ pool lifecycle

    /// @notice Create an empty pool for `token`, owned by the caller. One pool per (caller, token).
    function createPool(address token) external returns (bytes32 poolId) {
        return _createPool(token);
    }

    /// @notice Create a pool and, in the same transaction, fund it and start streams.
    /// @dev Caller must have approved `amount` of `token` to this contract first.
    function createPoolAndDeposit(
        address token,
        uint256 amount,
        address[] calldata employees,
        uint256[] calldata rateAmounts,
        uint256[] calldata ratePeriods
    ) external nonReentrant returns (bytes32 poolId) {
        poolId = _createPool(token);
        _deposit(poolId, amount, employees, rateAmounts, ratePeriods);
    }

    /// @notice Fund a pool and create/update streams for the listed employees.
    /// @dev Caller must be the org and must have approved `amount` of the pool token.
    ///      For an existing employee, accrued pay is crystallized at the OLD rate before the new
    ///      rate takes effect — the org cannot retroactively reduce already-earned pay.
    function deposit(
        bytes32 poolId,
        uint256 amount,
        address[] calldata employees,
        uint256[] calldata rateAmounts,
        uint256[] calldata ratePeriods
    ) external nonReentrant {
        _deposit(poolId, amount, employees, rateAmounts, ratePeriods);
    }

    /// @notice Add liquidity to a pool without touching streams (extends runway).
    function topup(bytes32 poolId, uint256 amount) external nonReentrant {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        if (msg.sender != pool.org) revert NotOrg();
        (uint256 fee, uint256 net) = _chargeAndFund(pool, amount);
        emit PoolToppedUp(poolId, msg.sender, amount, fee, net);
    }

    // ------------------------------------------------------------------ claiming

    /// @notice Claim all accrued pay from the caller's stream on `poolId`. Transfers to the caller.
    /// @return claimable The amount transferred.
    function claim(bytes32 poolId) external nonReentrant returns (uint256 claimable) {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        Stream storage s = _streams[poolId][msg.sender];
        if (!s.exists) revert StreamNotFound();

        uint64 effEnd = _effectiveEnd(s);
        claimable = s.pendingBalance + _accrued(s, effEnd);
        if (claimable == 0) revert ZeroClaimable();

        // Min-claim floor (anti-dust). Bypassed when crystallized `pendingBalance` exists so a
        // rate change never locks earned pay.
        if (claimable < MIN_CLAIM_AMOUNT && s.pendingBalance == 0) revert BelowMinClaim();

        if (pool.balance < claimable) revert InsufficientPoolBalance();

        // effects (checks-effects-interactions + nonReentrant)
        pool.totalClaimed += claimable;
        pool.balance -= claimable;
        s.claimedAt = effEnd;
        s.totalPausedSecs = 0;
        s.pendingBalance = 0;

        emit FundsClaimed(poolId, msg.sender, claimable, block.timestamp);

        IERC20(pool.token).safeTransfer(msg.sender, claimable);
    }

    /// @notice Settle `amount` of an employee's ALREADY-EARNED pay early (earned-wage advance),
    ///         paying it to `to`. Callable only by the wired advance module.
    /// @dev This is deliberately a thin primitive: it adds no new streaming math. It reuses the
    ///      same `_effectiveEnd`/`_accrued` pair `claim()` uses, so the advance can never disagree
    ///      with the claim path about what has been earned.
    ///
    ///      The "debit" is structural rather than a parallel debt ledger: accrual is crystallized
    ///      into `pendingBalance` (exactly as a rate change does in `_upsertStream`) and `amount`
    ///      is subtracted from it. The remainder stays claimable, so the worker's next `claim()`
    ///      is automatically reduced by whatever was drawn — there is no second number to drift.
    ///
    ///      An advance is therefore never a loan: it can only ever pay out wages the stream has
    ///      already accrued, and it is repaid by the claim the worker was always going to make.
    /// @param to Destination for the funds (the module, which then applies fee/subsidy accounting).
    /// @return remainingClaimable Claimable left on the stream immediately after the draw.
    function settleAdvance(bytes32 poolId, address employee, uint256 amount, address to)
        external
        nonReentrant
        returns (uint256 remainingClaimable)
    {
        if (msg.sender != advanceModule) revert NotAdvanceModule();
        if (to == address(0)) revert ZeroAddress();
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        Stream storage s = _streams[poolId][employee];
        if (!s.exists) revert StreamNotFound();
        if (amount == 0) revert ZeroClaimable();

        uint64 effEnd = _effectiveEnd(s);
        uint256 available = s.pendingBalance + _accrued(s, effEnd);
        if (amount > available) revert ExceedsClaimable();
        if (pool.balance < amount) revert InsufficientPoolBalance();

        // effects (checks-effects-interactions + nonReentrant)
        pool.totalClaimed += amount;
        pool.balance -= amount;
        s.claimedAt = effEnd;
        s.totalPausedSecs = 0;
        s.pendingBalance = available - amount; // crystallized remainder stays claimable
        remainingClaimable = s.pendingBalance;

        emit AdvanceSettled(poolId, employee, amount, to, remainingClaimable, block.timestamp);

        IERC20(pool.token).safeTransfer(to, amount);
    }

    // ------------------------------------------------------------------ stream control

    function pauseStream(bytes32 poolId, address employee) external {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        if (!_hasPoolRole(poolId, pool, msg.sender, PAUSER_ROLE)) revert NotAuthorized();
        Stream storage s = _streams[poolId][employee];
        if (!s.exists) revert StreamNotFound();
        if (s.pausedAt != 0 || s.stoppedAt != 0) revert StreamNotActive();
        s.pausedAt = uint64(block.timestamp);
        emit StreamPaused(poolId, employee, block.timestamp);
    }

    function resumeStream(bytes32 poolId, address employee) external {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        if (!_hasPoolRole(poolId, pool, msg.sender, PAUSER_ROLE)) revert NotAuthorized();
        Stream storage s = _streams[poolId][employee];
        if (!s.exists) revert StreamNotFound();
        if (s.pausedAt == 0) revert StreamNotPaused();
        s.totalPausedSecs += uint64(block.timestamp) - s.pausedAt;
        s.pausedAt = 0;
        emit StreamResumed(poolId, employee, block.timestamp);
    }

    /// @notice Permanently stop a stream. Accrued-but-unclaimed pay remains claimable.
    function stopStream(bytes32 poolId, address employee) external {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        if (msg.sender != pool.org) revert NotOrg();
        Stream storage s = _streams[poolId][employee];
        if (!s.exists) revert StreamNotFound();
        if (s.stoppedAt != 0) revert StreamAlreadyStopped();
        if (s.pausedAt != 0) {
            // Freeze at the pause point so paused time isn't paid out.
            s.stoppedAt = s.pausedAt;
            s.pausedAt = 0;
        } else {
            s.stoppedAt = uint64(block.timestamp);
        }
        emit StreamStopped(poolId, employee, s.stoppedAt);
    }

    // ------------------------------------------------------------------ roles

    function grantPoolRole(bytes32 poolId, address account, uint8 role) external {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        if (msg.sender != pool.org) revert NotOrg();
        _delegatedRoles[poolId][account] |= role;
        emit PoolRoleGranted(poolId, account, role);
    }

    function revokePoolRole(bytes32 poolId, address account, uint8 role) external {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        if (msg.sender != pool.org) revert NotOrg();
        _delegatedRoles[poolId][account] &= ~role;
        emit PoolRoleRevoked(poolId, account, role);
    }

    // ------------------------------------------------------------------ views

    /// @notice Live claimable amount for a stream (pendingBalance + accrual to now/pause/stop).
    function claimableAmount(bytes32 poolId, address employee) external view returns (uint256) {
        Stream storage s = _streams[poolId][employee];
        if (!s.exists) return 0;
        return s.pendingBalance + _accrued(s, _effectiveEnd(s));
    }

    function getPool(bytes32 poolId)
        external
        view
        returns (
            address org,
            address token,
            uint256 totalDeposited,
            uint256 totalClaimed,
            uint256 balance,
            bool exists
        )
    {
        Pool storage p = _pools[poolId];
        return (p.org, p.token, p.totalDeposited, p.totalClaimed, p.balance, p.exists);
    }

    function getStream(bytes32 poolId, address employee) external view returns (Stream memory) {
        return _streams[poolId][employee];
    }

    function hasStream(bytes32 poolId, address employee) external view returns (bool) {
        return _streams[poolId][employee].exists;
    }

    function employeesOf(bytes32 poolId) external view returns (address[] memory) {
        return _employeeList[poolId];
    }

    function employeeCount(bytes32 poolId) external view returns (uint256) {
        return _employeeList[poolId].length;
    }

    function orgPools(address org) external view returns (bytes32[] memory) {
        return _orgPools[org];
    }

    function employeePools(address employee) external view returns (bytes32[] memory) {
        return _employeePools[employee];
    }

    function hasPoolRole(bytes32 poolId, address account, uint8 role)
        external
        view
        returns (bool)
    {
        return _hasPoolRole(poolId, _pools[poolId], account, role);
    }

    function delegatedRoles(bytes32 poolId, address account) external view returns (uint8) {
        return _delegatedRoles[poolId][account];
    }

    // ------------------------------------------------------------------ internal

    function _createPool(address token) internal returns (bytes32 poolId) {
        if (token == address(0)) revert ZeroAddress();
        poolId = poolIdFor(msg.sender, token);
        if (_pools[poolId].exists) revert PoolAlreadyExists();
        _pools[poolId] =
            Pool({org: msg.sender, token: token, totalDeposited: 0, totalClaimed: 0, balance: 0, exists: true});
        _orgPools[msg.sender].push(poolId);
        emit PoolCreated(poolId, msg.sender, token);
    }

    function _deposit(
        bytes32 poolId,
        uint256 amount,
        address[] calldata employees,
        uint256[] calldata rateAmounts,
        uint256[] calldata ratePeriods
    ) internal {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert PoolNotFound();
        if (msg.sender != pool.org) revert NotOrg();
        if (employees.length != rateAmounts.length || employees.length != ratePeriods.length) {
            revert ArrayMismatch();
        }

        (uint256 fee, uint256 net) = _chargeAndFund(pool, amount);

        for (uint256 i; i < employees.length; ++i) {
            _upsertStream(poolId, employees[i], rateAmounts[i], ratePeriods[i]);
        }

        emit PoolFunded(poolId, msg.sender, amount, fee, net, block.timestamp);
    }

    /// @dev Pulls `gross` from the org, routes the deposit fee to the treasury, and credits the
    ///      net to the pool balance & totalDeposited. Assumes a standard (non-fee-on-transfer)
    ///      ERC-20 such as USDC.
    function _chargeAndFund(Pool storage pool, uint256 gross)
        internal
        returns (uint256 fee, uint256 net)
    {
        IERC20 token = IERC20(pool.token);
        token.safeTransferFrom(msg.sender, address(this), gross);

        fee = Math.mulDiv(gross, registry.depositFeeBps(), BPS_DENOM); // rounds down
        net = gross - fee;
        if (fee > 0) {
            token.safeTransfer(registry.treasury(), fee);
        }
        pool.balance += net;
        pool.totalDeposited += net;
    }

    function _upsertStream(bytes32 poolId, address employee, uint256 rateAmount, uint256 ratePeriod)
        internal
    {
        if (ratePeriod == 0) revert InvalidRatePeriod();
        if (employee == address(0)) revert ZeroAddress();
        Stream storage s = _streams[poolId][employee];
        if (s.exists) {
            // Crystallize earnings at the OLD rate up to the pause/stop/now point, then restart
            // streaming from NOW at the new rate. If the stream was paused or stopped, this
            // "re-hires" it (clears pausedAt/stoppedAt): earnings up to the pause/stop stay in
            // pendingBalance and the new rate streams from now — no backpay for the gap, and no
            // stranded funds (fixes re-deposit-on-stopped / re-deposit-on-paused).
            uint64 crystalEnd = _effectiveEnd(s);
            s.pendingBalance += _accrued(s, crystalEnd);
            s.claimedAt = uint64(block.timestamp);
            s.totalPausedSecs = 0;
            s.pausedAt = 0;
            s.stoppedAt = 0;
            s.rateAmount = rateAmount;
            s.ratePeriod = ratePeriod;
        } else {
            uint64 nowTs = uint64(block.timestamp);
            _streams[poolId][employee] = Stream({
                rateAmount: rateAmount,
                ratePeriod: ratePeriod,
                pendingBalance: 0,
                startedAt: nowTs,
                claimedAt: nowTs,
                totalPausedSecs: 0,
                pausedAt: 0,
                stoppedAt: 0,
                exists: true
            });
            _employeeList[poolId].push(employee);
            _employeePools[employee].push(poolId);
            emit StreamCreated(poolId, employee, rateAmount, ratePeriod, nowTs);
        }
    }

    /// @dev The timestamp streaming is measured up to: pause point, stop point, or now.
    function _effectiveEnd(Stream storage s) internal view returns (uint64) {
        if (s.pausedAt != 0) return s.pausedAt;
        if (s.stoppedAt != 0) return s.stoppedAt;
        return uint64(block.timestamp);
    }

    /// @dev Pay accrued at the current rate between `claimedAt` and `end`, excluding paused time.
    ///      Returns 0 (rather than reverting) on the degenerate windows so views never revert.
    function _accrued(Stream storage s, uint64 end) internal view returns (uint256) {
        if (end <= s.claimedAt) return 0;
        uint256 gross = uint256(end) - uint256(s.claimedAt);
        if (gross <= s.totalPausedSecs) return 0;
        uint256 elapsed = gross - s.totalPausedSecs;
        return Math.mulDiv(elapsed, s.rateAmount, s.ratePeriod);
    }

    function _hasPoolRole(bytes32 poolId, Pool storage pool, address account, uint8 role)
        internal
        view
        returns (bool)
    {
        return account == pool.org || (_delegatedRoles[poolId][account] & role != 0);
    }
}
