// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MagmosRegistry} from "../src/MagmosRegistry.sol";
import {MagmosPayroll} from "../src/MagmosPayroll.sol";
import {MagmosAdvance} from "../src/MagmosAdvance.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @title Earned Wage Access coverage
/// @notice The load-bearing property under test: a draw is ALWAYS an early settlement of wages
///         already accrued — never credit. So `drawn + claimed` can never exceed `earned`, under
///         any sequence of pauses, stops, rate changes or reentrancy attempts.
contract MagmosAdvanceTest is Test {
    MagmosRegistry registry;
    MagmosPayroll payroll;
    MagmosAdvance advance;
    MockERC20 usdc;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address org = makeAddr("org");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant RATE = 3000e6; // 3,000 USDC ...
    uint256 constant PERIOD = 30 days; // ... per 30 days => 100 USDC / day
    uint256 constant DAY = 1 days;
    uint256 constant PER_DAY = 100e6;

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new MagmosRegistry(admin, treasury);
        payroll = new MagmosPayroll(address(registry)); // this test contract is the deployer
        advance = new MagmosAdvance(address(payroll), address(registry), address(this));
        payroll.setAdvanceModule(address(advance));

        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdc.mint(org, 1_000_000e6);
        vm.prank(org);
        usdc.approve(address(payroll), type(uint256).max);

        // Core-mechanics tests run fee-free; fee/subsidy behaviour has dedicated tests below.
        advance.setDefaults(0, 10_000, 10_000);
    }

    // ---- helpers ----------------------------------------------------------

    function _one(address who, uint256 rate, uint256 period)
        internal
        pure
        returns (address[] memory e, uint256[] memory r, uint256[] memory p)
    {
        e = new address[](1);
        r = new uint256[](1);
        p = new uint256[](1);
        e[0] = who;
        r[0] = rate;
        p[0] = period;
    }

    function _createAndFund(uint256 amount, address who, uint256 rate, uint256 period)
        internal
        returns (bytes32 poolId)
    {
        (address[] memory e, uint256[] memory r, uint256[] memory p) = _one(who, rate, period);
        vm.prank(org);
        poolId = payroll.createPoolAndDeposit(address(usdc), amount, e, r, p);
    }

    // ---- wiring -----------------------------------------------------------

    function test_SetAdvanceModule_IsOneTimeOnly() public {
        vm.expectRevert(MagmosPayroll.AdvanceModuleAlreadySet.selector);
        payroll.setAdvanceModule(address(0xBEEF));
    }

    function test_SetAdvanceModule_OnlyDeployer() public {
        MagmosPayroll fresh = new MagmosPayroll(address(registry));
        vm.prank(alice);
        vm.expectRevert(MagmosPayroll.NotAuthorized.selector);
        fresh.setAdvanceModule(address(advance));
    }

    function test_SettleAdvance_OnlyCallableByModule() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY);
        // Even the employee cannot call the primitive directly — only the wired module may.
        vm.prank(alice);
        vm.expectRevert(MagmosPayroll.NotAdvanceModule.selector);
        payroll.settleAdvance(poolId, alice, 1e6, alice);
    }

    // ---- Feature 1: the draw ----------------------------------------------

    function test_Draw_PaysWorkerAndDebitsStream() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY); // earned 100 USDC

        assertEq(payroll.claimableAmount(poolId, alice), PER_DAY);
        assertEq(advance.drawableAmount(poolId, alice), PER_DAY);

        vm.prank(alice);
        uint256 net = advance.drawAdvance(poolId, 40e6);

        assertEq(net, 40e6, "worker receives the full draw when fee-free");
        assertEq(usdc.balanceOf(alice), 40e6);
        // The debit is structural: what is left is exactly what was earned minus what was drawn.
        assertEq(payroll.claimableAmount(poolId, alice), PER_DAY - 40e6);

        MagmosAdvance.Account memory a = advance.accountOf(poolId, alice);
        assertEq(a.totalDrawn, 40e6);
        assertEq(a.drawCount, 1);
        assertEq(advance.poolTotalDrawn(poolId), 40e6);
    }

    function test_Draw_RevertsAboveAccrued() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY); // earned 100

        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.ExceedsDrawLimit.selector);
        advance.drawAdvance(poolId, PER_DAY + 1); // one unit more than earned
    }

    function test_Draw_RevertsWithNoStream() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY);
        vm.prank(bob); // bob has no stream in this pool
        vm.expectRevert(MagmosAdvance.StreamNotFound.selector);
        advance.drawAdvance(poolId, 1e6);
    }

    function test_Draw_RevertsBelowMinDraw() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY);
        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.BelowMinDraw.selector);
        advance.drawAdvance(poolId, 9_999); // below the 0.01 USDC floor
    }

    function test_Draw_RevertsBeforeAnythingAccrues() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.NothingDrawable.selector);
        advance.drawAdvance(poolId, 1e6);
    }

    // ---- the repayment property: draw then claim ---------------------------

    function test_DrawThenClaim_ClaimIsReducedByTheDraw() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY); // earned 100

        vm.prank(alice);
        advance.drawAdvance(poolId, 60e6);

        vm.prank(alice);
        uint256 claimed = payroll.claim(poolId);

        assertEq(claimed, 40e6, "claim pays only the undrawn remainder");
        assertEq(usdc.balanceOf(alice), PER_DAY, "drawn + claimed == earned");
    }

    function test_DrawFull_ThenClaimHasNothingLeft() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY);

        vm.prank(alice);
        advance.drawAdvance(poolId, PER_DAY); // draw 100% of earned

        assertEq(payroll.claimableAmount(poolId, alice), 0);
        vm.prank(alice);
        vm.expectRevert(MagmosPayroll.ZeroClaimable.selector);
        payroll.claim(poolId);
    }

    function test_DrawThenKeepStreaming_ThenClaim() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY);

        vm.prank(alice);
        advance.drawAdvance(poolId, PER_DAY); // take the whole first day

        vm.warp(block.timestamp + 2 * DAY); // stream keeps running: 200 more

        assertEq(payroll.claimableAmount(poolId, alice), 2 * PER_DAY);
        vm.prank(alice);
        payroll.claim(poolId);
        assertEq(usdc.balanceOf(alice), 3 * PER_DAY, "3 days earned, 3 days received");
    }

    // ---- pause / stop interaction -----------------------------------------

    function test_Draw_OnPausedStream_UsesPausePointAndSurvivesResume() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + 10 * DAY); // earned 1000

        vm.prank(org);
        payroll.pauseStream(poolId, alice);

        vm.warp(block.timestamp + 5 * DAY); // paused: nothing accrues
        assertEq(payroll.claimableAmount(poolId, alice), 10 * PER_DAY);

        vm.prank(alice);
        advance.drawAdvance(poolId, 400e6);
        assertEq(payroll.claimableAmount(poolId, alice), 10 * PER_DAY - 400e6);

        vm.prank(org);
        payroll.resumeStream(poolId, alice);
        vm.warp(block.timestamp + 10 * DAY); // 10 more days of real streaming

        // 20 streaming days earned, 400 already drawn.
        assertEq(payroll.claimableAmount(poolId, alice), 20 * PER_DAY - 400e6);
        vm.prank(alice);
        payroll.claim(poolId);
        assertEq(usdc.balanceOf(alice), 20 * PER_DAY);
    }

    function test_Draw_OnStoppedStream_StillPaysEarnedRemainder() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + 10 * DAY);

        vm.prank(org);
        payroll.stopStream(poolId, alice);
        vm.warp(block.timestamp + 30 * DAY); // no further accrual after a stop

        assertEq(payroll.claimableAmount(poolId, alice), 10 * PER_DAY);
        vm.prank(alice);
        advance.drawAdvance(poolId, 250e6);
        assertEq(payroll.claimableAmount(poolId, alice), 10 * PER_DAY - 250e6);

        vm.prank(alice);
        payroll.claim(poolId);
        assertEq(usdc.balanceOf(alice), 10 * PER_DAY, "stopped stream still settles exactly");
    }

    function test_Draw_ThenRateChange_DoesNotResurrectDrawnPay() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY);

        vm.prank(alice);
        advance.drawAdvance(poolId, PER_DAY); // drew the whole first day

        // Employer re-deposits at a new rate — crystallization must not restore the drawn amount.
        (address[] memory e, uint256[] memory r, uint256[] memory p) = _one(alice, 6000e6, PERIOD);
        vm.prank(org);
        payroll.deposit(poolId, 1000e6, e, r, p);

        assertEq(payroll.claimableAmount(poolId, alice), 0, "drawn pay must not reappear");
    }

    // ---- liquidity guard ---------------------------------------------------

    function test_Drawable_CappedByPoolBalance() public {
        // Fund far less than the stream will accrue — the underfunded-pool case.
        bytes32 poolId = _createAndFund(250e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + 10 * DAY); // "earned" 1000, but only 250 is in the pool

        assertEq(payroll.claimableAmount(poolId, alice), 10 * PER_DAY);
        assertEq(advance.drawableAmount(poolId, alice), 250e6, "never promise more than is funded");

        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.ExceedsDrawLimit.selector);
        advance.drawAdvance(poolId, 251e6);

        vm.prank(alice);
        advance.drawAdvance(poolId, 250e6); // the whole funded balance is drawable
        assertEq(usdc.balanceOf(alice), 250e6);
    }

    // ---- Feature 2: fee + yield subsidy ------------------------------------

    function test_Fee_ChargedToWorkerWhenNoSubsidy() public {
        advance.setDefaults(50, 10_000, 10_000); // 0.5%
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY);

        (uint256 fee, uint256 sub, uint256 workerPays, uint256 net) = advance.quote(poolId, 100e6);
        assertEq(fee, 0.5e6);
        assertEq(sub, 0, "no subsidy parked yet");
        assertEq(workerPays, 0.5e6);
        assertEq(net, 99.5e6);

        vm.prank(alice);
        uint256 got = advance.drawAdvance(poolId, 100e6);
        assertEq(got, 99.5e6);
        assertEq(usdc.balanceOf(alice), 99.5e6);
        assertEq(usdc.balanceOf(treasury), 0.5e6, "fee routed to treasury");
        // The stream is still debited the FULL 100 — the fee is priced into the draw, not hidden.
        assertEq(payroll.claimableAmount(poolId, alice), 0);
    }

    function test_Fee_FullyCoveredByYieldSubsidy() public {
        advance.setDefaults(50, 10_000, 10_000); // 0.5%
        // Park yield in the subsidy pool (in the demo this comes from the float's vault yield).
        usdc.mint(address(this), 100e6);
        usdc.approve(address(advance), type(uint256).max);
        advance.fundSubsidy(address(usdc), 10e6);

        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + DAY);

        (uint256 fee, uint256 sub, uint256 workerPays, uint256 net) = advance.quote(poolId, 100e6);
        assertEq(fee, 0.5e6);
        assertEq(sub, 0.5e6, "float yield absorbs the whole fee");
        assertEq(workerPays, 0);
        assertEq(net, 100e6);

        vm.prank(alice);
        advance.drawAdvance(poolId, 100e6);

        assertEq(usdc.balanceOf(alice), 100e6, "worker pays nothing");
        assertEq(usdc.balanceOf(treasury), 0.5e6, "treasury still made whole, out of yield");
        assertEq(advance.subsidyBalance(address(usdc)), 9.5e6);

        (,, uint256 feesSubsidized, uint256 feesPaidByWorkers,) = advance.stats();
        assertEq(feesSubsidized, 0.5e6);
        assertEq(feesPaidByWorkers, 0, "the float paid, not the worker");
    }

    function test_Fee_PartialSubsidySplitsCorrectly() public {
        advance.setDefaults(200, 10_000, 10_000); // 2% (the ceiling)
        usdc.mint(address(this), 100e6);
        usdc.approve(address(advance), type(uint256).max);
        advance.fundSubsidy(address(usdc), 1e6); // only 1 USDC of subsidy available

        bytes32 poolId = _createAndFund(50_000e6, alice, RATE, PERIOD);
        vm.warp(block.timestamp + 30 * DAY); // earned 3000

        // 2% of 3000 = 60 fee; only 1 can be subsidized, so the worker bears 59.
        vm.prank(alice);
        uint256 net = advance.drawAdvance(poolId, 3000e6);
        assertEq(net, 3000e6 - 59e6);
        assertEq(advance.subsidyBalance(address(usdc)), 0);
        assertEq(usdc.balanceOf(treasury), 60e6);
    }

    function test_SetDefaults_RejectsFeeAboveCeiling() public {
        vm.expectRevert(MagmosAdvance.FeeTooHigh.selector);
        advance.setDefaults(201, 10_000, 10_000);
    }

    // ---- policy ------------------------------------------------------------

    function test_Policy_MaxDrawBpsCapsTheDraw() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.prank(org);
        advance.setPoolPolicy(poolId, 5000, 10_000, false); // employer allows only 50%

        vm.warp(block.timestamp + DAY); // earned 100
        assertEq(advance.drawableAmount(poolId, alice), 50e6);

        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.ExceedsDrawLimit.selector);
        advance.drawAdvance(poolId, 51e6);

        vm.prank(alice);
        advance.drawAdvance(poolId, 50e6);
        assertEq(usdc.balanceOf(alice), 50e6);
    }

    function test_Policy_EmployerCanDisableAdvances() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.prank(org);
        advance.setPoolPolicy(poolId, 10_000, 10_000, true); // disabled
        vm.warp(block.timestamp + DAY);

        assertEq(advance.drawableAmount(poolId, alice), 0);
        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.AdvancesDisabled.selector);
        advance.drawAdvance(poolId, 10e6);
    }

    function test_Policy_OnlyOrgMaySet() public {
        bytes32 poolId = _createAndFund(10_000e6, alice, RATE, PERIOD);
        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.NotOrg.selector);
        advance.setPoolPolicy(poolId, 5000, 0, false);
    }

    // ---- employer exposure view -------------------------------------------

    function test_PoolExposure_SumsEveryStream() public {
        address[] memory e = new address[](2);
        uint256[] memory r = new uint256[](2);
        uint256[] memory p = new uint256[](2);
        (e[0], r[0], p[0]) = (alice, RATE, PERIOD);
        (e[1], r[1], p[1]) = (bob, RATE, PERIOD);
        vm.prank(org);
        bytes32 poolId = payroll.createPoolAndDeposit(address(usdc), 50_000e6, e, r, p);

        vm.warp(block.timestamp + DAY); // each earned 100

        (uint256 drawableNow, uint256 lifetime, uint256 workers) = advance.poolExposure(poolId);
        assertEq(drawableNow, 2 * PER_DAY);
        assertEq(lifetime, 0);
        assertEq(workers, 2);

        vm.prank(alice);
        advance.drawAdvance(poolId, 100e6);

        (drawableNow, lifetime,) = advance.poolExposure(poolId);
        assertEq(drawableNow, PER_DAY, "alice drew hers; bob's remains");
        assertEq(lifetime, 100e6);
    }

    // ---- the money invariant (fuzz) ---------------------------------------

    /// @notice For ANY rate, elapsed time and draw fraction: drawn + claimed == earned, exactly.
    ///         This is what makes an advance settlement rather than credit.
    function testFuzz_DrawPlusClaim_EqualsEarned(uint96 monthly, uint32 elapsed, uint16 drawBps)
        public
    {
        monthly = uint96(bound(monthly, 1e6, 1_000_000e6));
        elapsed = uint32(bound(elapsed, 1 hours, 365 days));
        drawBps = uint16(bound(drawBps, 0, 10_000));

        bytes32 poolId = _createAndFund(1_000_000e6, alice, monthly, PERIOD);
        vm.warp(block.timestamp + elapsed);

        uint256 earned = payroll.claimableAmount(poolId, alice);
        vm.assume(earned >= 10_000 && earned <= 1_000_000e6); // above dust, within funding

        uint256 want = (earned * drawBps) / 10_000;
        if (want >= 10_000) {
            vm.prank(alice);
            advance.drawAdvance(poolId, want);
        } else {
            want = 0;
        }

        uint256 left = payroll.claimableAmount(poolId, alice);
        assertEq(left, earned - want, "remaining claimable is exactly the undrawn part");

        if (left > 0) {
            vm.prank(alice);
            payroll.claim(poolId);
        }
        assertEq(usdc.balanceOf(alice), earned, "drawn + claimed == earned, never more");
    }

    // ---- reentrancy --------------------------------------------------------

    /// @notice A malicious pool token cannot re-enter the draw to double-spend accrued pay.
    function test_Draw_ReentrancyBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        MagmosPayroll pay2 = new MagmosPayroll(address(registry));
        MagmosAdvance adv2 = new MagmosAdvance(address(pay2), address(registry), address(this));
        pay2.setAdvanceModule(address(adv2));
        adv2.setDefaults(0, 10_000, 10_000);

        DrawAttacker attacker = new DrawAttacker(adv2);

        evil.mint(org, 1_000_000e6);
        vm.prank(org);
        evil.approve(address(pay2), type(uint256).max);

        (address[] memory e, uint256[] memory r, uint256[] memory p) =
            _one(address(attacker), RATE, PERIOD);
        vm.prank(org);
        bytes32 poolId = pay2.createPoolAndDeposit(address(evil), 100_000e6, e, r, p);
        attacker.setPool(poolId);
        evil.setHook(address(attacker));

        vm.warp(block.timestamp + 30 days); // accrue ~3000

        attacker.doDraw(1000e6);

        assertEq(attacker.reentered(), 0, "reentrancy not blocked");
        assertEq(evil.balanceOf(address(attacker)), 1000e6, "exactly one draw, no double-drain");
    }
}

/// ERC-20 that pokes a hook on the recipient during transfer (to attempt reentrancy).
contract ReentrantToken is ERC20 {
    address public hook;
    bool private _inHook;

    constructor() ERC20("Evil", "EVIL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function setHook(address h) external {
        hook = h;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to == hook && hook != address(0) && !_inHook) {
            _inHook = true;
            DrawAttacker(hook).onTokens();
            _inHook = false;
        }
    }
}

contract DrawAttacker {
    MagmosAdvance public advance;
    bytes32 public poolId;
    uint256 public reentered;

    constructor(MagmosAdvance a) {
        advance = a;
    }

    function setPool(bytes32 id) external {
        poolId = id;
    }

    function doDraw(uint256 amount) external {
        advance.drawAdvance(poolId, amount);
    }

    function onTokens() external {
        // Attempt to re-enter the draw; nonReentrant must make this revert (caught here).
        try advance.drawAdvance(poolId, 1e6) {
            reentered++;
        } catch {}
    }
}
