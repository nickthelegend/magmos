// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {Test, Vm} from "forge-std/Test.sol";
import {MagmosRegistry} from "../src/MagmosRegistry.sol";
import {MagmosPayroll} from "../src/MagmosPayroll.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @title Confidential settlement of streamed pay
/// @notice `settleSealed` lets an org settle already-accrued pay so it can be delivered off the
///         public ledger. The properties under test are the ones that make that safe: it can only
///         ever pay the org, it can never exceed accrual, it agrees exactly with `claim()` about
///         what is left, and it is inert until the org explicitly grants SEALER_ROLE.
contract MagmosSealTest is Test {
    MagmosRegistry registry;
    MagmosPayroll payroll;
    MockERC20 usdc;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address org = makeAddr("org");
    address sealer = makeAddr("sealer"); // the org's payroll signer
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address attacker = makeAddr("attacker");

    uint256 constant RATE = 3000e6;
    uint256 constant PERIOD = 30 days;
    uint256 constant DAY = 1 days;
    uint256 constant PER_DAY = 100e6;
    bytes32 constant SEAL_REF = keccak256("unlink:sealed-delivery-1");

    // Cached because `payroll.SEALER_ROLE()` is an external call: reading it on a pranked line
    // consumes the prank, so `grantPoolRole` would arrive from the test contract and revert NotOrg.
    uint8 sealerRole;
    uint8 pauserRole;

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new MagmosRegistry(admin, treasury);
        payroll = new MagmosPayroll(address(registry));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdc.mint(org, 1_000_000e6);
        vm.prank(org);
        usdc.approve(address(payroll), type(uint256).max);
        sealerRole = payroll.SEALER_ROLE();
        pauserRole = payroll.PAUSER_ROLE();
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

    function _fundedPool(uint256 amount, address who) internal returns (bytes32 poolId) {
        (address[] memory e, uint256[] memory r, uint256[] memory p) = _one(who);
        vm.prank(org);
        poolId = payroll.createPoolAndDeposit(address(usdc), amount, e, r, p);
    }

    function _withSealer(uint256 amount, address who) internal returns (bytes32 poolId) {
        poolId = _fundedPool(amount, who);
        vm.prank(org);
        payroll.grantPoolRole(poolId, sealer, sealerRole);
    }

    // ---- authorisation -----------------------------------------------------

    function test_Seal_RequiresSealerRole() public {
        bytes32 poolId = _fundedPool(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        // No role granted: sealing is inert by default. Every existing pool keeps working as-is.
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.NotAuthorized.selector);
        payroll.settleSealed(poolId, alice, 10e6, SEAL_REF);
    }

    function test_Seal_AttackerCannotSeal() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(attacker);
        vm.expectRevert(MagmosPayroll.NotAuthorized.selector);
        payroll.settleSealed(poolId, alice, 10e6, SEAL_REF);
    }

    function test_Seal_OrgItselfCanSealWithoutAnExplicitGrant() public {
        // `_hasPoolRole` treats the org as holding every role on its own pool.
        bytes32 poolId = _fundedPool(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(org);
        payroll.settleSealed(poolId, alice, 40e6, SEAL_REF);
        assertEq(usdc.balanceOf(org), 1_000_000e6 - 10_000e6 + 40e6);
    }

    function test_Seal_RevokingTheRoleStopsIt() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(org);
        payroll.revokePoolRole(poolId, sealer, sealerRole);
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.NotAuthorized.selector);
        payroll.settleSealed(poolId, alice, 10e6, SEAL_REF);
    }

    function test_Seal_PauserRoleDoesNotConferSealing() public {
        bytes32 poolId = _fundedPool(10_000e6, alice);
        vm.prank(org);
        payroll.grantPoolRole(poolId, sealer, pauserRole);
        vm.warp(block.timestamp + DAY);
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.NotAuthorized.selector);
        payroll.settleSealed(poolId, alice, 10e6, SEAL_REF);
    }

    // ---- the custody guarantee --------------------------------------------

    function test_Seal_AlwaysPaysTheOrgNeverTheSealer() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);

        uint256 orgBefore = usdc.balanceOf(org);
        vm.prank(sealer);
        payroll.settleSealed(poolId, alice, PER_DAY, SEAL_REF);

        // The sealer moves money, but never to itself — this is what makes delegating it safe.
        assertEq(usdc.balanceOf(sealer), 0, "sealer must never receive funds");
        assertEq(usdc.balanceOf(org), orgBefore + PER_DAY, "settled to the org treasury");
        assertEq(usdc.balanceOf(alice), 0, "delivery happens off-ledger, not here");
    }

    // ---- accrual bound + agreement with claim() ---------------------------

    function test_Seal_CannotExceedAccrual() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.ExceedsClaimable.selector);
        payroll.settleSealed(poolId, alice, PER_DAY + 1, SEAL_REF);
    }

    function test_Seal_ReducesClaimableByExactlyTheSealedAmount() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);

        vm.prank(sealer);
        uint256 remaining = payroll.settleSealed(poolId, alice, 60e6, SEAL_REF);

        assertEq(remaining, PER_DAY - 60e6);
        assertEq(payroll.claimableAmount(poolId, alice), PER_DAY - 60e6);

        // The worker can still claim the unsealed remainder themselves.
        vm.prank(alice);
        assertEq(payroll.claim(poolId), PER_DAY - 60e6);
    }

    function test_Seal_ThenClaim_TotalsExactlyWhatWasEarned() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);

        vm.prank(sealer);
        payroll.settleSealed(poolId, alice, 70e6, SEAL_REF);
        vm.prank(alice);
        uint256 claimed = payroll.claim(poolId);

        assertEq(70e6 + claimed, PER_DAY, "sealed + claimed == earned, never more");
    }

    function test_Seal_FullAccrual_LeavesNothingToClaim() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(sealer);
        payroll.settleSealed(poolId, alice, PER_DAY, SEAL_REF);

        assertEq(payroll.claimableAmount(poolId, alice), 0);
        vm.prank(alice);
        vm.expectRevert(MagmosPayroll.ZeroClaimable.selector);
        payroll.claim(poolId);
    }

    function test_Seal_StreamKeepsAccruingAfterwards() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(sealer);
        payroll.settleSealed(poolId, alice, PER_DAY, SEAL_REF);

        vm.warp(block.timestamp + 2 * DAY);
        assertEq(payroll.claimableAmount(poolId, alice), 2 * PER_DAY, "sealing is not stopping");
    }

    // ---- interaction with pause / stop ------------------------------------

    function test_Seal_OnPausedStream_UsesThePausePoint() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(org);
        payroll.pauseStream(poolId, alice);
        vm.warp(block.timestamp + 5 * DAY); // paused — no accrual

        vm.prank(sealer);
        payroll.settleSealed(poolId, alice, 400e6, SEAL_REF);
        assertEq(payroll.claimableAmount(poolId, alice), 10 * PER_DAY - 400e6);

        vm.prank(org);
        payroll.resumeStream(poolId, alice);
        vm.warp(block.timestamp + 10 * DAY);
        assertEq(
            payroll.claimableAmount(poolId, alice), 20 * PER_DAY - 400e6, "paused time excluded"
        );
    }

    function test_Seal_OnStoppedStream_SettlesTheRemainder() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(org);
        payroll.stopStream(poolId, alice);
        vm.warp(block.timestamp + 30 * DAY);

        vm.prank(sealer);
        payroll.settleSealed(poolId, alice, 10 * PER_DAY, SEAL_REF);
        assertEq(payroll.claimableAmount(poolId, alice), 0);
    }

    // ---- guards ------------------------------------------------------------

    function test_Seal_RevertsOnUnknownStream() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.StreamNotFound.selector);
        payroll.settleSealed(poolId, bob, 1e6, SEAL_REF);
    }

    function test_Seal_RevertsOnZeroAmount() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.ZeroClaimable.selector);
        payroll.settleSealed(poolId, alice, 0, SEAL_REF);
    }

    function test_Seal_BoundedByPoolLiquidity() public {
        bytes32 poolId = _withSealer(50e6, alice); // funded far below what accrues
        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.InsufficientPoolBalance.selector);
        payroll.settleSealed(poolId, alice, 10 * PER_DAY, SEAL_REF);
    }

    function test_Seal_EmitsRefWithoutRevealingRecipientPayoutAddress() public {
        bytes32 poolId = _withSealer(10_000e6, alice);
        vm.warp(block.timestamp + DAY);

        vm.recordLogs();
        vm.prank(sealer);
        payroll.settleSealed(poolId, alice, 25e6, SEAL_REF);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            // PaySealed(bytes32 indexed, address indexed, uint256, bytes32 indexed, uint256, uint256)
            if (
                logs[i].topics[0]
                    == keccak256("PaySealed(bytes32,address,uint256,bytes32,uint256,uint256)")
            ) {
                assertEq(logs[i].topics[3], SEAL_REF, "the opaque delivery commitment is on-chain");
                found = true;
            }
        }
        assertTrue(found, "PaySealed not emitted");
    }

    // ---- the money invariant, under fuzz ----------------------------------

    /// @notice For any accrual and any split between sealing and claiming, the worker's stream can
    ///         never yield more than it earned — sealing does not create or destroy pay.
    function testFuzz_SealPlusClaim_EqualsEarned(uint96 monthly, uint32 elapsed, uint16 sealBps)
        public
    {
        monthly = uint96(bound(monthly, 1e6, 1_000_000e6));
        elapsed = uint32(bound(elapsed, 1 hours, 365 days));
        sealBps = uint16(bound(sealBps, 0, 10_000));

        (address[] memory e, uint256[] memory r, uint256[] memory p) = _one(alice);
        r[0] = monthly;
        vm.prank(org);
        bytes32 poolId = payroll.createPoolAndDeposit(address(usdc), 1_000_000e6, e, r, p);
        vm.prank(org);
        payroll.grantPoolRole(poolId, sealer, sealerRole);

        vm.warp(block.timestamp + elapsed);
        uint256 earned = payroll.claimableAmount(poolId, alice);
        vm.assume(earned >= 10_000 && earned <= 1_000_000e6);

        uint256 toSeal = (earned * sealBps) / 10_000;
        uint256 orgBefore = usdc.balanceOf(org);
        if (toSeal > 0) {
            vm.prank(sealer);
            payroll.settleSealed(poolId, alice, toSeal, SEAL_REF);
        }

        uint256 left = payroll.claimableAmount(poolId, alice);
        assertEq(left, earned - toSeal, "remaining is exactly the unsealed part");

        if (left > 0) {
            vm.prank(alice);
            payroll.claim(poolId);
        }
        assertEq(
            usdc.balanceOf(alice) + (usdc.balanceOf(org) - orgBefore),
            earned,
            "sealed + claimed == earned, exactly"
        );
    }

    // ---- settleAllSealed: the confidential path ---------------------------

    function _twoPersonPool() internal returns (bytes32 poolId) {
        address[] memory e = new address[](2);
        uint256[] memory r = new uint256[](2);
        uint256[] memory p = new uint256[](2);
        e[0] = alice; e[1] = bob;
        r[0] = RATE;  r[1] = RATE * 2;
        p[0] = PERIOD; p[1] = PERIOD;
        vm.prank(org);
        poolId = payroll.createPoolAndDeposit(address(usdc), 100_000e6, e, r, p);
        vm.prank(org);
        payroll.grantPoolRole(poolId, sealer, sealerRole);
    }

    function test_SealAll_SettlesEveryStreamAndPaysOrg() public {
        bytes32 poolId = _twoPersonPool();
        vm.warp(block.timestamp + DAY);

        uint256 orgBefore = usdc.balanceOf(org);
        vm.prank(sealer);
        (uint256 total, uint256 count) = payroll.settleAllSealed(poolId, SEAL_REF);

        // alice earns 100/day, bob 200/day.
        assertEq(count, 2, "both streams settled");
        assertEq(total, PER_DAY * 3, "total is the sum of both accruals");
        assertEq(usdc.balanceOf(org), orgBefore + total, "org received exactly the total");
        assertEq(payroll.claimableAmount(poolId, alice), 0, "alice fully crystallised");
        assertEq(payroll.claimableAmount(poolId, bob), 0, "bob fully crystallised");
    }

    /// The whole point: the event carries no recipient and no per-person figure.
    function test_SealAll_EmitsNoRecipientAndNoPerPersonAmount() public {
        bytes32 poolId = _twoPersonPool();
        vm.warp(block.timestamp + DAY);

        vm.recordLogs();
        vm.prank(sealer);
        payroll.settleAllSealed(poolId, SEAL_REF);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 sig = keccak256("PayrollSealed(bytes32,bytes32,uint256,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; ++i) {
            for (uint256 t = 0; t < logs[i].topics.length; ++t) {
                // No employee address may appear in ANY indexed slot of ANY log.
                assertTrue(
                    logs[i].topics[t] != bytes32(uint256(uint160(alice))),
                    "alice leaked in a topic"
                );
                assertTrue(
                    logs[i].topics[t] != bytes32(uint256(uint160(bob))),
                    "bob leaked in a topic"
                );
            }
            if (logs[i].topics[0] == sig) {
                found = true;
                (uint256 total, uint256 count,) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256));
                assertEq(total, PER_DAY * 3, "aggregate is public, deliberately");
                assertEq(count, 2, "headcount is public, deliberately");
            }
        }
        assertTrue(found, "PayrollSealed emitted");
    }

    function test_SealAll_RequiresSealerRole() public {
        bytes32 poolId = _twoPersonPool();
        vm.warp(block.timestamp + DAY);
        vm.prank(attacker);
        vm.expectRevert(MagmosPayroll.NotAuthorized.selector);
        payroll.settleAllSealed(poolId, SEAL_REF);
    }

    function test_SealAll_RevertsWhenNothingAccrued() public {
        bytes32 poolId = _twoPersonPool();
        // No time has passed, so there is nothing to settle. Better to revert than to emit an empty
        // settlement that looks like a payroll run in the audit trail.
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.ZeroClaimable.selector);
        payroll.settleAllSealed(poolId, SEAL_REF);
    }

    function test_SealAll_CannotDoubleSettle() public {
        bytes32 poolId = _twoPersonPool();
        vm.warp(block.timestamp + DAY);
        vm.prank(sealer);
        payroll.settleAllSealed(poolId, SEAL_REF);
        // Immediately again: everything was crystallised, so there is nothing left.
        vm.prank(sealer);
        vm.expectRevert(MagmosPayroll.ZeroClaimable.selector);
        payroll.settleAllSealed(poolId, SEAL_REF);
    }

    function test_SealAll_AgreesWithClaimAccounting() public {
        bytes32 poolId = _twoPersonPool();
        vm.warp(block.timestamp + DAY);
        vm.prank(sealer);
        (uint256 total,) = payroll.settleAllSealed(poolId, SEAL_REF);

        // A sealed run and a claim must never disagree about what was earned: after settling,
        // an employee claiming immediately gets only what re-accrued, not a second copy.
        vm.warp(block.timestamp + DAY);
        vm.prank(alice);
        payroll.claim(poolId);
        assertEq(usdc.balanceOf(alice), PER_DAY, "alice got exactly one further day");
        assertEq(total, PER_DAY * 3, "the sealed total was the first day only");
    }
}
