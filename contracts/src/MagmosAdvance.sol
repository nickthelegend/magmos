// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMagmosPayroll} from "./interfaces/IMagmosPayroll.sol";
import {IMagmosRegistry} from "./interfaces/IMagmosRegistry.sol";

/// @title MagmosAdvance — Earned Wage Access on a live payroll stream
/// @notice Lets a worker draw wages they have ALREADY earned, instantly, before the payroll
///         claim event — with no credit check, no underwriting, and no employer guarantor.
///
/// @dev Why this needs no underwriting:
///      Because payroll streams on-chain per second, the worker's earned-but-unclaimed balance is
///      not a prediction — it is contract state, readable at `payroll.claimableAmount()`. That
///      balance IS the collateral, and it is already escrowed by the employer in the pool. So the
///      only question a lender normally has to answer ("will this person actually get paid?") is
///      answered structurally, in advance, by the stream itself.
///
///      This is therefore **earned wage access, not a payday loan**. A draw can never exceed wages
///      already accrued, so there is no principal at risk, no interest on principal, and no debt
///      that can outlive the pay period.
///
/// @dev Architecture — why the accounting lives next door:
///      MagmosPayroll custodies the USDC and owns the stream accounting, so this module cannot
///      (and must not) move funds itself. It holds all EWA *policy* — limits, fees, the yield
///      subsidy, and the audit trail — and delegates the single privileged act to
///      `payroll.settleAdvance()`, which reuses the exact `_accrued`/`_effectiveEnd` math that
///      `claim()` uses. There is deliberately no debt ledger here that mirrors stream state:
///      the draw crystallizes accrual and subtracts from `pendingBalance` inside the payroll, so
///      repayment happens automatically at the worker's next claim and the two can never drift.
contract MagmosAdvance is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IMagmosPayroll public immutable payroll;
    IMagmosRegistry public immutable registry;

    uint256 public constant BPS_DENOM = 10_000;
    /// @notice Hard ceiling on the access fee: 2%. EWA must never drift into payday-loan pricing.
    uint256 public constant MAX_ADVANCE_FEE_BPS = 200;

    /// @notice Access fee in bps, charged on the drawn amount. Covered by float yield where
    ///         subsidy is available, so the worker typically pays nothing.
    uint256 public advanceFeeBps;
    /// @notice Default share of accrued pay a worker may draw, in bps (10_000 = 100%).
    uint16 public defaultMaxDrawBps;
    /// @notice Default anti-dust minimum draw.
    uint256 public defaultMinDraw;

    struct PoolPolicy {
        uint16 maxDrawBps;
        uint256 minDraw;
        bool disabled; // employer opt-out for their own pool
        bool exists;
    }

    struct Account {
        uint256 totalDrawn;
        uint256 feesPaid; // borne by the worker (post-subsidy)
        uint256 feesSubsidized; // borne by float yield
        uint64 lastDrawAt;
        uint32 drawCount;
    }

    mapping(bytes32 poolId => PoolPolicy) private _policies;
    mapping(bytes32 poolId => mapping(address worker => Account)) private _accounts;
    mapping(bytes32 poolId => uint256 drawn) public poolTotalDrawn;
    mapping(bytes32 poolId => uint256 fees) public poolFeesCharged;
    mapping(bytes32 poolId => uint256 fees) public poolFeesSubsidized;

    /// @notice Yield parked here to absorb access fees, per token.
    mapping(address token => uint256) public subsidyBalance;

    // Lifetime protocol counters — the honest trail behind "the float pays, not the worker".
    uint256 public totalAdvanced;
    uint256 public totalFeesCharged;
    uint256 public totalFeesSubsidized;
    uint256 public totalYieldContributed;

    /// @notice A worker drew already-earned wages early.
    event AdvanceDrawn(
        bytes32 indexed poolId,
        address indexed worker,
        uint256 amount,
        uint256 fee,
        uint256 subsidizedByYield,
        uint256 netToWorker,
        uint256 remainingClaimable,
        uint256 timestamp
    );
    event SubsidyFunded(address indexed token, address indexed from, uint256 amount);
    event SubsidyWithdrawn(address indexed token, address indexed to, uint256 amount);
    event PoolPolicySet(bytes32 indexed poolId, uint16 maxDrawBps, uint256 minDraw, bool disabled);
    event DefaultsSet(uint256 advanceFeeBps, uint16 defaultMaxDrawBps, uint256 defaultMinDraw);

    error PoolNotFound();
    error StreamNotFound();
    error AdvancesDisabled();
    error BelowMinDraw();
    error ExceedsDrawLimit();
    error NothingDrawable();
    error FeeTooHigh();
    error InvalidBps();
    error NotOrg();
    error ZeroAmount();
    error InsufficientSubsidy();
    error ZeroAddress();

    constructor(address payroll_, address registry_, address owner_) Ownable(owner_) {
        payroll = IMagmosPayroll(payroll_);
        registry = IMagmosRegistry(registry_);
        advanceFeeBps = 50; // 0.5% — fully yield-subsidized by default
        defaultMaxDrawBps = 10_000; // a worker may draw 100% of what they have earned
        defaultMinDraw = 10_000; // 0.01 USDC (6dp), mirrors the payroll anti-dust floor
    }

    // ------------------------------------------------------------------ draw

    /// @notice Draw `amount` of already-earned wages immediately.
    /// @dev The amount is capped by live accrual (checked here against policy, then re-checked
    ///      authoritatively inside `payroll.settleAdvance`). Funds route through this module for
    ///      one hop so the fee/subsidy split is applied atomically; the worker still ends the
    ///      transaction holding plain USDC in their own wallet, exactly as after a claim — which
    ///      is what keeps the CCTP "send home" path identical for advances and claims.
    /// @return netToWorker USDC actually delivered to the worker.
    function drawAdvance(bytes32 poolId, uint256 amount)
        external
        nonReentrant
        returns (uint256 netToWorker)
    {
        return _draw(poolId, amount, msg.sender);
    }

    /// @notice Draw earned pay straight to another address — a bridge, an exchange, family.
    /// @dev Saves the worker a second transaction (and a second gas payment) when the money is
    ///      going somewhere else anyway. The draw is still charged against THEIR stream only.
    function drawAdvanceTo(bytes32 poolId, uint256 amount, address to)
        external
        nonReentrant
        returns (uint256 netToWorker)
    {
        if (to == address(0)) revert ZeroAddress();
        return _draw(poolId, amount, to);
    }

    /// @notice Draw everything currently available, without having to read the limit first.
    function drawMax(bytes32 poolId) external nonReentrant returns (uint256 netToWorker) {
        PoolPolicy memory pol = policyOf(poolId);
        if (pol.disabled) revert AdvancesDisabled();
        uint256 limit = _drawable(poolId, msg.sender, pol);
        if (limit < pol.minDraw || limit == 0) revert NothingDrawable();
        return _draw(poolId, limit, msg.sender);
    }

    function _draw(bytes32 poolId, uint256 amount, address to)
        internal
        returns (uint256 netToWorker)
    {
        if (amount == 0) revert ZeroAmount();
        (, address token,) = _pool(poolId); // reverts if the pool does not exist
        if (!payroll.hasStream(poolId, msg.sender)) revert StreamNotFound();

        PoolPolicy memory pol = policyOf(poolId);
        if (pol.disabled) revert AdvancesDisabled();
        if (amount < pol.minDraw) revert BelowMinDraw();

        uint256 limit = _drawable(poolId, msg.sender, pol);
        if (limit == 0) revert NothingDrawable();
        if (amount > limit) revert ExceedsDrawLimit();

        // Fee, then how much of it the float yield can absorb on the worker's behalf.
        uint256 fee = Math.mulDiv(amount, advanceFeeBps, BPS_DENOM);
        uint256 subsidized = Math.min(fee, subsidyBalance[token]);
        uint256 workerPays = fee - subsidized;
        netToWorker = amount - workerPays;

        // ---- effects ----
        Account storage acct = _accounts[poolId][msg.sender];
        acct.totalDrawn += amount;
        acct.feesPaid += workerPays;
        acct.feesSubsidized += subsidized;
        acct.lastDrawAt = uint64(block.timestamp);
        unchecked {
            ++acct.drawCount;
        }
        poolTotalDrawn[poolId] += amount;
        poolFeesCharged[poolId] += fee;
        poolFeesSubsidized[poolId] += subsidized;
        totalAdvanced += amount;
        totalFeesCharged += fee;
        totalFeesSubsidized += subsidized;
        subsidyBalance[token] -= subsidized;

        // ---- interactions ----
        // Authoritative check + settlement: reverts unless `amount` is genuinely earned.
        uint256 remaining = payroll.settleAdvance(poolId, msg.sender, amount, address(this));

        IERC20(token).safeTransfer(to, netToWorker);
        if (fee > 0) {
            IERC20(token).safeTransfer(registry.treasury(), fee);
        }

        emit AdvanceDrawn(
            poolId, msg.sender, amount, fee, subsidized, netToWorker, remaining, block.timestamp
        );
    }

    // ------------------------------------------------------------------ yield subsidy

    /// @notice Park yield here to absorb workers' access fees.
    /// @dev Deliberately permissionless: an org, the yield vault, or the protocol can top it up.
    ///      Every contribution is counted in `totalYieldContributed`, so the dashboard claim
    ///      "the float paid the fee, not the worker" is auditable rather than asserted.
    function fundSubsidy(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        subsidyBalance[token] += amount;
        totalYieldContributed += amount;
        emit SubsidyFunded(token, msg.sender, amount);
    }

    function withdrawSubsidy(address token, address to, uint256 amount) external onlyOwner {
        if (amount > subsidyBalance[token]) revert InsufficientSubsidy();
        subsidyBalance[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit SubsidyWithdrawn(token, to, amount);
    }

    // ------------------------------------------------------------------ policy

    /// @notice An employer caps (or disables) early access for their own pool.
    /// @dev Employers do NOT approve individual draws — that would reintroduce the guarantor
    ///      model EWA exists to remove. They set an exposure envelope, once.
    function setPoolPolicy(bytes32 poolId, uint16 maxDrawBps, uint256 minDraw, bool disabled)
        external
    {
        (address org,,) = _pool(poolId);
        if (msg.sender != org) revert NotOrg();
        if (maxDrawBps > BPS_DENOM) revert InvalidBps();
        _policies[poolId] = PoolPolicy({
            maxDrawBps: maxDrawBps, minDraw: minDraw, disabled: disabled, exists: true
        });
        emit PoolPolicySet(poolId, maxDrawBps, minDraw, disabled);
    }

    function setDefaults(uint256 advanceFeeBps_, uint16 maxDrawBps_, uint256 minDraw_)
        external
        onlyOwner
    {
        if (advanceFeeBps_ > MAX_ADVANCE_FEE_BPS) revert FeeTooHigh();
        if (maxDrawBps_ > BPS_DENOM) revert InvalidBps();
        advanceFeeBps = advanceFeeBps_;
        defaultMaxDrawBps = maxDrawBps_;
        defaultMinDraw = minDraw_;
        emit DefaultsSet(advanceFeeBps_, maxDrawBps_, minDraw_);
    }

    // ------------------------------------------------------------------ views

    function policyOf(bytes32 poolId) public view returns (PoolPolicy memory) {
        PoolPolicy memory p = _policies[poolId];
        if (!p.exists) {
            p = PoolPolicy({
                maxDrawBps: defaultMaxDrawBps,
                minDraw: defaultMinDraw,
                disabled: false,
                exists: false
            });
        }
        return p;
    }

    /// @notice How much this worker can draw right now.
    function drawableAmount(bytes32 poolId, address worker) public view returns (uint256) {
        PoolPolicy memory pol = policyOf(poolId);
        if (pol.disabled) return 0;
        return _drawable(poolId, worker, pol);
    }

    /// @notice Preview a draw without sending it.
    /// @return fee Total access fee.
    /// @return subsidized Portion covered by float yield.
    /// @return workerPays What the worker actually bears.
    /// @return netToWorker USDC delivered to the worker.
    function quote(bytes32 poolId, uint256 amount)
        external
        view
        returns (uint256 fee, uint256 subsidized, uint256 workerPays, uint256 netToWorker)
    {
        (, address token,) = _pool(poolId);
        fee = Math.mulDiv(amount, advanceFeeBps, BPS_DENOM);
        subsidized = Math.min(fee, subsidyBalance[token]);
        workerPays = fee - subsidized;
        netToWorker = amount - workerPays;
    }

    function accountOf(bytes32 poolId, address worker) external view returns (Account memory) {
        return _accounts[poolId][worker];
    }

    /// @notice Live employer exposure: total drawable across every stream in the pool right now.
    /// @dev View-only, so the O(n) sweep costs the employer dashboard nothing.
    function poolExposure(bytes32 poolId)
        external
        view
        returns (uint256 drawableNow, uint256 lifetimeDrawn, uint256 workers)
    {
        PoolPolicy memory pol = policyOf(poolId);
        address[] memory list = payroll.employeesOf(poolId);
        workers = list.length;
        if (!pol.disabled) {
            for (uint256 i; i < list.length; ++i) {
                drawableNow += _drawable(poolId, list[i], pol);
            }
        }
        lifetimeDrawn = poolTotalDrawn[poolId];
    }

    /// @notice Drawable for many workers at once — one RPC round trip for a whole roster.
    function drawableBatch(bytes32 poolId, address[] calldata workers)
        external
        view
        returns (uint256[] memory out)
    {
        PoolPolicy memory pol = policyOf(poolId);
        out = new uint256[](workers.length);
        if (pol.disabled) return out;
        for (uint256 i; i < workers.length; ++i) {
            out[i] = _drawable(poolId, workers[i], pol);
        }
    }

    /// @notice Per-pool EWA economics, so an employer sees their own numbers rather than global.
    function poolStats(bytes32 poolId)
        external
        view
        returns (uint256 drawn, uint256 feesCharged, uint256 feesSubsidized, uint256 feesOnWorkers)
    {
        drawn = poolTotalDrawn[poolId];
        feesCharged = poolFeesCharged[poolId];
        feesSubsidized = poolFeesSubsidized[poolId];
        feesOnWorkers = feesCharged - feesSubsidized;
    }

    /// @notice Protocol-wide EWA stats for the "yield covers the fee" breakdown.
    function stats()
        external
        view
        returns (
            uint256 advanced,
            uint256 feesCharged,
            uint256 feesSubsidized,
            uint256 feesPaidByWorkers,
            uint256 yieldContributed
        )
    {
        advanced = totalAdvanced;
        feesCharged = totalFeesCharged;
        feesSubsidized = totalFeesSubsidized;
        feesPaidByWorkers = totalFeesCharged - totalFeesSubsidized;
        yieldContributed = totalYieldContributed;
    }

    // ------------------------------------------------------------------ internal

    function _drawable(bytes32 poolId, address worker, PoolPolicy memory pol)
        internal
        view
        returns (uint256)
    {
        uint256 claimable = payroll.claimableAmount(poolId, worker);
        uint256 capped = Math.mulDiv(claimable, pol.maxDrawBps, BPS_DENOM);
        // Never promise more than the pool can actually pay out right now.
        (,,,, uint256 balance,) = payroll.getPool(poolId);
        return Math.min(capped, balance);
    }

    function _pool(bytes32 poolId)
        internal
        view
        returns (address org, address token, uint256 balance)
    {
        bool exists;
        (org, token,,, balance, exists) = payroll.getPool(poolId);
        if (!exists) revert PoolNotFound();
    }
}
