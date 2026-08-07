// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MagmosStealthPayout} from "../src/MagmosStealthPayout.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * The payout leg's job is to deliver salary without publishing who it belongs to. These tests hold
 * it to both halves of that: the money must arrive exactly once and in full, and nothing an observer
 * can read may name a recipient.
 */
contract MagmosStealthPayoutTest is Test {
    MagmosStealthPayout payout;
    MockERC20 usdc;

    address org = makeAddr("org");
    address relayer = makeAddr("relayer");
    address attacker = makeAddr("attacker");

    // Stealth identities. In production these are ECDH-derived and unlinkable; here they only need
    // to be keys the test can sign with.
    uint256 aliceStealthPk = 0xA11CE;
    uint256 bobStealthPk = 0xB0B;
    address aliceStealth;
    address bobStealth;

    // Where employees actually want the money — deliberately different from the stealth address.
    address aliceCashOut = makeAddr("aliceCashOut");
    address bobCashOut = makeAddr("bobCashOut");

    bytes32 constant BATCH = keccak256("magmos:run:2026-08");

    /// Cached in setUp because reading it is an EXTERNAL call: evaluated inside a `_sign(...)`
    /// argument it becomes the call `vm.expectRevert` watches, so the assertion passes on the wrong
    /// call and a genuinely-reverting claim reads as "did not revert".
    bytes32 domSep;
    uint256 constant ALICE_AMT = 3_000e6;
    uint256 constant BOB_AMT = 5_500e6;
    uint64 constant TTL = 30 days;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        payout = new MagmosStealthPayout(address(usdc));
        aliceStealth = vm.addr(aliceStealthPk);
        bobStealth = vm.addr(bobStealthPk);

        usdc.mint(org, 1_000_000e6);
        vm.prank(org);
        usdc.approve(address(payout), type(uint256).max);
        domSep = payout.domainSeparator();
    }

    // ---- helpers -----------------------------------------------------------

    function _leaf(address stealth, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(stealth, amount));
    }

    /// Two-leaf tree; the sibling IS the proof.
    function _root(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _fund() internal returns (bytes32 la, bytes32 lb) {
        la = _leaf(aliceStealth, ALICE_AMT);
        lb = _leaf(bobStealth, BOB_AMT);

        bytes[] memory eph = new bytes[](2);
        eph[0] = hex"02aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
        eph[1] = hex"03112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00";
        uint8[] memory tags = new uint8[](2);
        tags[0] = 0x7f;
        tags[1] = 0x2c;

        bytes32[] memory encAmts = new bytes32[](2);
        encAmts[0] = bytes32(uint256(0xdead));
        encAmts[1] = bytes32(uint256(0xbeef));
        bytes32[] memory ls = new bytes32[](2);
        ls[0] = la;
        ls[1] = lb;

        vm.prank(org);
        payout.fundBatch(
            MagmosStealthPayout.BatchInput({
                batchId: BATCH, root: _root(la, lb), total: ALICE_AMT + BOB_AMT, recipientCount: 2, ttl: TTL
            }),
            eph, tags, encAmts, ls
        );
    }

    function _sign(uint256 pk, uint256 amount, address to) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(keccak256("Claim(bytes32 batchId,uint256 amount,address to)"), BATCH, amount, to)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _proof(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    // ---- funding -----------------------------------------------------------

    function test_Fund_DepositsTotalAndRecordsBatch() public {
        _fund();
        assertEq(usdc.balanceOf(address(payout)), ALICE_AMT + BOB_AMT, "total escrowed");
        MagmosStealthPayout.Batch memory b = payout.getBatch(BATCH);
        assertEq(b.total, ALICE_AMT + BOB_AMT);
        assertEq(b.recipientCount, 2);
        assertEq(b.funder, org);
    }

    /// Reusing a batch id would replace a root and strip every unclaimed recipient of their proof.
    function test_Fund_CannotReuseBatchId() public {
        _fund();
        bytes[] memory eph = new bytes[](0);
        uint8[] memory tags = new uint8[](0);
        bytes32[] memory none = new bytes32[](0);
        vm.prank(org);
        vm.expectRevert(MagmosStealthPayout.BatchExists.selector);
        payout.fundBatch(
            MagmosStealthPayout.BatchInput({batchId: BATCH, root: keccak256("other"), total: 1e6, recipientCount: 1, ttl: TTL}),
            eph, tags, none, none
        );
    }

    function test_Fund_RejectsAbsurdTtl() public {
        bytes[] memory eph = new bytes[](0);
        uint8[] memory tags = new uint8[](0);
        bytes32[] memory none = new bytes32[](0);
        vm.prank(org);
        vm.expectRevert(MagmosStealthPayout.InvalidExpiry.selector);
        payout.fundBatch(
            MagmosStealthPayout.BatchInput({batchId: BATCH, root: keccak256("r"), total: 1e6, recipientCount: 1, ttl: 1 hours}),
            eph, tags, none, none
        );
    }

    // ---- the privacy property ---------------------------------------------

    /**
     * The whole reason this contract exists: funding a payroll batch must not publish a recipient.
     * Checks every topic AND every data word of every log against both stealth addresses.
     */
    function test_Fund_PublishesNoRecipient() public {
        vm.recordLogs();
        _fund();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = 0; i < logs.length; ++i) {
            for (uint256 t = 0; t < logs[i].topics.length; ++t) {
                assertTrue(logs[i].topics[t] != bytes32(uint256(uint160(aliceStealth))), "alice in topic");
                assertTrue(logs[i].topics[t] != bytes32(uint256(uint160(bobStealth))), "bob in topic");
            }
            bytes memory d = logs[i].data;
            for (uint256 o = 0; o + 32 <= d.length; o += 32) {
                bytes32 word;
                assembly {
                    word := mload(add(add(d, 32), o))
                }
                assertTrue(word != bytes32(uint256(uint160(aliceStealth))), "alice in data");
                assertTrue(word != bytes32(uint256(uint160(bobStealth))), "bob in data");
            }
        }
    }

    // ---- claiming ----------------------------------------------------------

    function test_Claim_PaysTheDestinationNotTheStealthAddress() public {
        (bytes32 la, bytes32 lb) = _fund();
        vm.prank(relayer);
        payout.claim(BATCH, ALICE_AMT, aliceCashOut, _proof(lb), _sign(aliceStealthPk, ALICE_AMT, aliceCashOut));

        assertEq(usdc.balanceOf(aliceCashOut), ALICE_AMT, "alice paid at her chosen address");
        assertEq(usdc.balanceOf(aliceStealth), 0, "stealth address never holds the funds");
        assertTrue(payout.leafClaimed(BATCH, la), "leaf burned");
    }

    /// The stealth address has no gas and must never need any — a third party pays for the claim.
    function test_Claim_RelayerPaysGasAndCannotRedirect() public {
        (, bytes32 lb) = _fund();
        bytes memory sig = _sign(aliceStealthPk, ALICE_AMT, aliceCashOut);

        // Same signature, attacker swaps the destination: the digest changes, recovery yields a
        // different address, and no leaf matches it.
        vm.prank(attacker);
        vm.expectRevert(MagmosStealthPayout.BadProof.selector);
        payout.claim(BATCH, ALICE_AMT, attacker, _proof(lb), sig);
    }

    function test_Claim_CannotReplay() public {
        (, bytes32 lb) = _fund();
        bytes memory sig = _sign(aliceStealthPk, ALICE_AMT, aliceCashOut);
        vm.prank(relayer);
        payout.claim(BATCH, ALICE_AMT, aliceCashOut, _proof(lb), sig);

        vm.prank(relayer);
        vm.expectRevert(MagmosStealthPayout.AlreadyClaimed.selector);
        payout.claim(BATCH, ALICE_AMT, aliceCashOut, _proof(lb), sig);
    }

    /// Claiming more than the committed leaf must fail — otherwise one recipient drains the batch.
    function test_Claim_CannotInflateAmount() public {
        (, bytes32 lb) = _fund();
        vm.prank(relayer);
        vm.expectRevert(MagmosStealthPayout.BadProof.selector);
        payout.claim(
            BATCH, ALICE_AMT + 1e6, aliceCashOut, _proof(lb), _sign(aliceStealthPk, ALICE_AMT + 1e6, aliceCashOut)
        );
    }

    function test_Claim_OutsiderWithoutAStealthKeyGetsNothing() public {
        (, bytes32 lb) = _fund();
        uint256 attackerPk = 0xBAD;
        vm.prank(attacker);
        vm.expectRevert(MagmosStealthPayout.BadProof.selector);
        payout.claim(BATCH, ALICE_AMT, attacker, _proof(lb), _sign(attackerPk, ALICE_AMT, attacker));
    }

    function test_Claim_BothRecipientsIndependently() public {
        (bytes32 la, bytes32 lb) = _fund();
        vm.prank(relayer);
        payout.claim(BATCH, ALICE_AMT, aliceCashOut, _proof(lb), _sign(aliceStealthPk, ALICE_AMT, aliceCashOut));
        // Bob claims later, in a different block — no cohort for an observer to correlate.
        vm.warp(block.timestamp + 3 days);
        vm.prank(relayer);
        payout.claim(BATCH, BOB_AMT, bobCashOut, _proof(la), _sign(bobStealthPk, BOB_AMT, bobCashOut));

        assertEq(usdc.balanceOf(aliceCashOut), ALICE_AMT);
        assertEq(usdc.balanceOf(bobCashOut), BOB_AMT);
        assertEq(usdc.balanceOf(address(payout)), 0, "batch fully drained");
    }

    function test_Claim_RejectsGarbageSignature() public {
        (, bytes32 lb) = _fund();
        vm.expectRevert(MagmosStealthPayout.BadSignature.selector);
        payout.claim(BATCH, ALICE_AMT, aliceCashOut, _proof(lb), hex"1234");
    }

    // ---- reclaim -----------------------------------------------------------

    function test_Reclaim_OnlyAfterExpiryAndOnlyTheRemainder() public {
        (, bytes32 lb) = _fund();
        vm.prank(relayer);
        payout.claim(BATCH, ALICE_AMT, aliceCashOut, _proof(lb), _sign(aliceStealthPk, ALICE_AMT, aliceCashOut));

        vm.prank(org);
        vm.expectRevert(MagmosStealthPayout.NotExpired.selector);
        payout.reclaim(BATCH);

        vm.warp(block.timestamp + TTL + 1);
        uint256 before = usdc.balanceOf(org);
        vm.prank(org);
        uint256 got = payout.reclaim(BATCH);

        assertEq(got, BOB_AMT, "only what nobody claimed");
        assertEq(usdc.balanceOf(org), before + BOB_AMT);
    }

    /// An employer must not be able to cancel salary that is owed and merely unclaimed.
    function test_Reclaim_StrangerCannot() public {
        _fund();
        vm.warp(block.timestamp + TTL + 1);
        vm.prank(attacker);
        vm.expectRevert(MagmosStealthPayout.NotFunder.selector);
        payout.reclaim(BATCH);
    }

    function test_Reclaim_CannotDoubleReclaim() public {
        _fund();
        vm.warp(block.timestamp + TTL + 1);
        vm.prank(org);
        payout.reclaim(BATCH);
        vm.prank(org);
        vm.expectRevert(MagmosStealthPayout.NothingToReclaim.selector);
        payout.reclaim(BATCH);
    }

    /// Bob's claim must still work if the employer reclaimed nothing — reclaim marks the batch fully
    /// claimed, so this asserts the ordering cannot silently rob a late claimant before expiry.
    function test_Claim_StillWorksRightUpToExpiry() public {
        (bytes32 la,) = _fund();
        vm.warp(block.timestamp + TTL - 1);
        vm.prank(relayer);
        payout.claim(BATCH, BOB_AMT, bobCashOut, _proof(la), _sign(bobStealthPk, BOB_AMT, bobCashOut));
        assertEq(usdc.balanceOf(bobCashOut), BOB_AMT);
    }

    function testFuzz_Claim_ArbitraryDestination(address dest) public {
        vm.assume(dest != address(0) && dest != address(payout));
        vm.assume(usdc.balanceOf(dest) == 0);
        (, bytes32 lb) = _fund();
        vm.prank(relayer);
        payout.claim(BATCH, ALICE_AMT, dest, _proof(lb), _sign(aliceStealthPk, ALICE_AMT, dest));
        assertEq(usdc.balanceOf(dest), ALICE_AMT);
    }

    /**
     * Self-custody: the chain must carry everything a recipient needs to claim without the
     * employer's server. That means the leaves, so the tree can be rebuilt, and an encrypted amount,
     * so the recipient knows which leaf is theirs.
     */
    function test_Fund_PublishesLeavesAndEncryptedAmounts() public {
        vm.recordLogs();
        (bytes32 la, bytes32 lb) = _fund();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 leavesSig = keccak256("BatchLeaves(bytes32,bytes32[])");
        bytes32 annSig = keccak256("Announcement(bytes32,bytes,uint8,bytes32)");
        bool sawLeaves;
        uint256 announcements;

        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == leavesSig) {
                sawLeaves = true;
                bytes32[] memory published = abi.decode(logs[i].data, (bytes32[]));
                assertEq(published.length, 2, "every leaf published");
                assertEq(published[0], la);
                assertEq(published[1], lb);
            }
            if (logs[i].topics[0] == annSig) announcements++;
        }
        assertTrue(sawLeaves, "BatchLeaves emitted");
        assertEq(announcements, 2, "one announcement per recipient");
    }

    /// Publishing leaves must not publish recipients — they are hashes, and that is the point.
    function test_Fund_LeavesRevealNoAddress() public {
        vm.recordLogs();
        _fund();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 leavesSig = keccak256("BatchLeaves(bytes32,bytes32[])");
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] != leavesSig) continue;
            bytes32[] memory published = abi.decode(logs[i].data, (bytes32[]));
            for (uint256 j = 0; j < published.length; ++j) {
                assertTrue(published[j] != bytes32(uint256(uint160(aliceStealth))), "alice leaked");
                assertTrue(published[j] != bytes32(uint256(uint160(bobStealth))), "bob leaked");
            }
        }
    }
}
