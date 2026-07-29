// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MagmosRegistry} from "../src/MagmosRegistry.sol";
import {MagmosPayroll} from "../src/MagmosPayroll.sol";
import {MagmosAdvance} from "../src/MagmosAdvance.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @title Batch operations, solvency observability, and draw destinations
/// @notice Covers the convenience/visibility surface added on top of the core loop: multi-pool
///         claiming, roster-wide batch reads and controls, and the pool-liability views that make
///         the (deliberately unenforced) funding gap observable instead of implicit.
contract MagmosBatchTest is Test {
    MagmosRegistry registry;
    MagmosPayroll payroll;
    MagmosAdvance advance;
    MockERC20 usdc;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address orgA = makeAddr("orgA");
    address orgB = makeAddr("orgB");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address family = makeAddr("family");

    uint256 constant RATE = 3000e6;
    uint256 constant PERIOD = 30 days;
    uint256 constant DAY = 1 days;
    uint256 constant PER_DAY = 100e6;

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new MagmosRegistry(admin, treasury);
        payroll = new MagmosPayroll(address(registry));
        advance = new MagmosAdvance(address(payroll), address(registry), address(this));
        payroll.setAdvanceModule(address(advance));
        advance.setDefaults(0, 10_000, 10_000); // fee-free for clean arithmetic

        usdc = new MockERC20("USD Coin", "USDC", 6);
        for (uint256 i; i < 2; ++i) {
            address o = i == 0 ? orgA : orgB;
            usdc.mint(o, 1_000_000e6);
            vm.prank(o);
            usdc.approve(address(payroll), type(uint256).max);
        }
    }

    function _one(address who)
        internal
        pure
        returns (address[] memory e, uint256[] memory r, uint256[] memory p)
    {
        e = new address[](1);
        r = new uint256[](1);
        p = new uint256[](1);
        e[0] = who;
        r[0] = RATE;
        p[0] = PERIOD;
    }

    function _pool(address org, uint256 fund, address who) internal returns (bytes32 id) {
        (address[] memory e, uint256[] memory r, uint256[] memory p) = _one(who);
        vm.prank(org);
        id = payroll.createPoolAndDeposit(address(usdc), fund, e, r, p);
    }

    // ---- multi-pool claiming ------------------------------------------------

    function test_ClaimMany_SumsAcrossPools() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        bytes32 b = _pool(orgB, 10_000e6, alice);
        vm.warp(block.timestamp + DAY);

        bytes32[] memory ids = new bytes32[](2);
        (ids[0], ids[1]) = (a, b);

        vm.prank(alice);
        uint256 total = payroll.claimMany(ids);
        assertEq(total, 2 * PER_DAY, "both employers settled in one transaction");
        assertEq(usdc.balanceOf(alice), 2 * PER_DAY);
    }

    function test_ClaimMany_SkipsEmptyPoolsInsteadOfReverting() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        bytes32 b = _pool(orgB, 10_000e6, bob); // alice has no stream here
        vm.warp(block.timestamp + DAY);

        bytes32[] memory ids = new bytes32[](2);
        (ids[0], ids[1]) = (a, b);
        vm.prank(alice);
        uint256 total = payroll.claimMany(ids);
        assertEq(total, PER_DAY, "the unrelated pool is skipped, not fatal");
    }

    function test_ClaimMany_RevertsWhenNothingAnywhere() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = a;
        vm.prank(alice);
        vm.expectRevert(MagmosPayroll.ZeroClaimable.selector);
        payroll.claimMany(ids); // nothing has accrued yet
    }

    function test_ClaimTo_SendsElsewhere() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(alice);
        payroll.claimTo(a, family);
        assertEq(usdc.balanceOf(family), PER_DAY);
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_ClaimTo_RejectsZeroAddress() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(alice);
        vm.expectRevert(MagmosPayroll.ZeroAddress.selector);
        payroll.claimTo(a, address(0));
    }

    // ---- solvency observability -------------------------------------------

    function test_PoolLiability_ReportsShortfallWhenUnderfunded() public {
        bytes32 a = _pool(orgA, 250e6, alice); // funds 250, will accrue 1000
        vm.warp(block.timestamp + 10 * DAY);

        (uint256 accrued, uint256 balance, uint256 shortfall) = payroll.poolLiability(a);
        assertEq(accrued, 10 * PER_DAY);
        assertEq(balance, 250e6);
        assertEq(shortfall, 10 * PER_DAY - 250e6, "the gap is visible, not hidden");
        assertEq(payroll.requiredTopUp(a), shortfall);
    }

    function test_PoolLiability_NoShortfallWhenCovered() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        (uint256 accrued, uint256 balance, uint256 shortfall) = payroll.poolLiability(a);
        assertEq(accrued, PER_DAY);
        assertEq(balance, 10_000e6);
        assertEq(shortfall, 0);
        assertEq(payroll.requiredTopUp(a), 0);
    }

    function test_RequiredTopUp_ClearsAfterTopUp() public {
        bytes32 a = _pool(orgA, 100e6, alice);
        vm.warp(block.timestamp + 5 * DAY); // accrued 500, funded 100
        uint256 need = payroll.requiredTopUp(a);
        assertEq(need, 400e6);

        vm.prank(orgA);
        payroll.topup(a, need);
        assertEq(payroll.requiredTopUp(a), 0, "fully covered after the prescribed top-up");
    }

    function test_ClaimableBatch_MatchesIndividualReads() public {
        address[] memory e = new address[](2);
        uint256[] memory r = new uint256[](2);
        uint256[] memory p = new uint256[](2);
        (e[0], r[0], p[0]) = (alice, RATE, PERIOD);
        (e[1], r[1], p[1]) = (bob, RATE * 2, PERIOD);
        vm.prank(orgA);
        bytes32 a = payroll.createPoolAndDeposit(address(usdc), 100_000e6, e, r, p);
        vm.warp(block.timestamp + DAY);

        uint256[] memory batch = payroll.claimableBatch(a, e);
        assertEq(batch[0], payroll.claimableAmount(a, alice));
        assertEq(batch[1], payroll.claimableAmount(a, bob));
        assertEq(batch[1], 2 * batch[0]);
    }

    // ---- batch stream control ---------------------------------------------

    function test_PauseMany_ResumeMany_AndSkipInactive() public {
        address[] memory e = new address[](2);
        uint256[] memory r = new uint256[](2);
        uint256[] memory p = new uint256[](2);
        (e[0], r[0], p[0]) = (alice, RATE, PERIOD);
        (e[1], r[1], p[1]) = (bob, RATE, PERIOD);
        vm.prank(orgA);
        bytes32 a = payroll.createPoolAndDeposit(address(usdc), 100_000e6, e, r, p);

        vm.warp(block.timestamp + DAY);
        vm.prank(orgA);
        payroll.pauseMany(a, e);
        assertTrue(payroll.getStream(a, alice).pausedAt != 0);
        assertTrue(payroll.getStream(a, bob).pausedAt != 0);

        vm.warp(block.timestamp + DAY); // paused — no accrual
        assertEq(payroll.claimableAmount(a, alice), PER_DAY);

        // Re-pausing an already-paused roster must be a no-op, not a revert.
        vm.prank(orgA);
        payroll.pauseMany(a, e);

        vm.prank(orgA);
        payroll.resumeMany(a, e);
        assertEq(payroll.getStream(a, alice).pausedAt, 0);

        vm.warp(block.timestamp + DAY);
        assertEq(payroll.claimableAmount(a, alice), 2 * PER_DAY, "paused day excluded");
    }

    function test_PauseMany_RequiresPauserRole() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        address[] memory e = new address[](1);
        e[0] = alice;
        vm.prank(bob);
        vm.expectRevert(MagmosPayroll.NotAuthorized.selector);
        payroll.pauseMany(a, e);
    }

    // ---- draw destinations + batch views ----------------------------------

    function test_DrawAdvanceTo_PaysDestinationButChargesWorker() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.warp(block.timestamp + DAY);

        vm.prank(alice);
        advance.drawAdvanceTo(a, 60e6, family);

        assertEq(usdc.balanceOf(family), 60e6, "money went to the destination");
        assertEq(usdc.balanceOf(alice), 0, "worker's own wallet untouched");
        assertEq(payroll.claimableAmount(a, alice), PER_DAY - 60e6, "charged to her stream");
        assertEq(advance.accountOf(a, alice).totalDrawn, 60e6);
    }

    function test_DrawAdvanceTo_RejectsZeroAddress() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.ZeroAddress.selector);
        advance.drawAdvanceTo(a, 10e6, address(0));
    }

    function test_DrawMax_TakesEverythingAvailable() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.warp(block.timestamp + DAY);

        vm.prank(alice);
        uint256 net = advance.drawMax(a);
        assertEq(net, PER_DAY);
        assertEq(payroll.claimableAmount(a, alice), 0);
    }

    function test_DrawMax_RespectsEmployerCap() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.prank(orgA);
        advance.setPoolPolicy(a, 5000, 10_000, false); // 50%
        vm.warp(block.timestamp + DAY);

        vm.prank(alice);
        advance.drawMax(a);
        assertEq(usdc.balanceOf(alice), 50e6, "capped at half of earned");
    }

    function test_DrawMax_RevertsWhenNothingDrawable() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.prank(alice);
        vm.expectRevert(MagmosAdvance.NothingDrawable.selector);
        advance.drawMax(a);
    }

    function test_DrawableBatch_MatchesIndividualReads() public {
        address[] memory e = new address[](2);
        uint256[] memory r = new uint256[](2);
        uint256[] memory p = new uint256[](2);
        (e[0], r[0], p[0]) = (alice, RATE, PERIOD);
        (e[1], r[1], p[1]) = (bob, RATE, PERIOD);
        vm.prank(orgA);
        bytes32 a = payroll.createPoolAndDeposit(address(usdc), 100_000e6, e, r, p);
        vm.warp(block.timestamp + DAY);

        uint256[] memory batch = advance.drawableBatch(a, e);
        assertEq(batch[0], advance.drawableAmount(a, alice));
        assertEq(batch[1], advance.drawableAmount(a, bob));
    }

    function test_DrawableBatch_AllZeroWhenDisabled() public {
        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.prank(orgA);
        advance.setPoolPolicy(a, 10_000, 10_000, true);
        vm.warp(block.timestamp + DAY);

        address[] memory e = new address[](1);
        e[0] = alice;
        assertEq(advance.drawableBatch(a, e)[0], 0);
    }

    function test_PoolStats_TracksPerPoolFeeSplit() public {
        advance.setDefaults(100, 10_000, 10_000); // 1%
        usdc.mint(address(this), 1000e6);
        usdc.approve(address(advance), type(uint256).max);
        advance.fundSubsidy(address(usdc), 10e6);

        bytes32 a = _pool(orgA, 10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(alice);
        advance.drawAdvance(a, 100e6); // fee 1 USDC, fully subsidized

        (uint256 drawn, uint256 charged, uint256 subsidized, uint256 onWorkers) =
            advance.poolStats(a);
        assertEq(drawn, 100e6);
        assertEq(charged, 1e6);
        assertEq(subsidized, 1e6);
        assertEq(onWorkers, 0, "this employer's float covered its own workers' fees");
    }
}
