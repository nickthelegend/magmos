// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {MerkleProof} from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MagmosStealthPayout
 * @notice Confidential delivery of payroll on a transparent chain.
 *
 * @dev THE PROBLEM. `MagmosPayroll.settleAllSealed` crystallises a whole payroll run into the org
 * treasury without naming anyone — but the money still has to reach people. Paying each employee
 * directly would undo all of it: an ERC-20 `Transfer` publishes the recipient in an indexed topic
 * and the salary in the clear, forever filterable by address. Arc's own confidential-transfer
 * feature would solve this, but its documentation states privacy is "on the roadmap and not yet
 * available", so it cannot be relied on today.
 *
 * THE APPROACH. Stealth addresses, the ERC-5564 construction. Each employee publishes a meta-address
 * once — a spending key and a viewing key. For every payment the employer derives a fresh one-time
 * address via ECDH:
 *
 *     ephemeral key r,  R = r·G                     (published)
 *     shared secret s = keccak256(r·V)              (V = employee viewing pubkey)
 *     stealth pubkey  P = S + s·G                   (S = employee spending pubkey)
 *     stealth address = address(P)
 *
 * Only the employee can compute the matching private key, because only they hold V's scalar. An
 * observer sees payouts to unrelated-looking addresses and cannot tie any of them to a person. The
 * employee finds their own payment by scanning `Announcement` events with their viewing key.
 *
 * WHY A MERKLE ROOT rather than N transfers. Transferring to each stealth address at payout time
 * would put N amounts on-chain in one transaction, and the count alone reveals headcount while the
 * timing correlates every recipient into one visible cohort. Instead the employer commits a root and
 * deposits the total; employees claim independently, whenever they like. Claims scatter across time
 * and blocks, so there is no cohort to correlate.
 *
 * WHY SIGNATURE-AUTHORISED CLAIMS. A freshly derived stealth address holds no gas, so it cannot pay
 * for its own claim. Requiring it to be funded first would create exactly the linking transaction
 * this design removes — someone would have to send it gas, and that sender is a clue. Here the
 * stealth key only signs; anyone may relay the transaction. The signature commits to the
 * destination, so a relayer cannot redirect the funds.
 *
 * WHAT IS STILL PUBLIC, stated plainly:
 *   - the batch total and the recipient count (aggregate spend is the auditable part)
 *   - each claim's amount and its destination address
 * What is NOT public: which employee any stealth address or claim belongs to. Identity is the
 * secret; the aggregate is not.
 */
contract MagmosStealthPayout is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Token every batch is denominated in. Single-token by design: a per-batch token would
    /// let an employer fingerprint a recipient by paying them in something nobody else receives.
    IERC20 public immutable token;

    struct Batch {
        bytes32 root;
        uint256 total;
        uint256 claimed;
        address funder;
        uint64 fundedAt;
        /// @dev After this, the funder may reclaim what is left. Without it, a lost viewing key
        /// would strand salary in this contract permanently.
        uint64 expiresAt;
        uint32 recipientCount;
        bool exists;
    }

    /**
     * @notice Batch metadata, grouped into one calldata struct.
     * @dev Not cosmetic: passed as nine flat parameters this function exceeded the EVM's 16-slot
     * reach and would not compile ("stack too deep"). A struct keeps it one slot and reads better at
     * the call site than nine positional arguments.
     */
    struct BatchInput {
        bytes32 batchId;
        bytes32 root;
        uint256 total;
        uint32 recipientCount;
        uint64 ttl;
    }

    mapping(bytes32 batchId => Batch) private _batches;
    /// @dev Claim-once, keyed by leaf so a valid proof cannot be replayed.
    mapping(bytes32 batchId => mapping(bytes32 leaf => bool)) public leafClaimed;

    /// @notice EIP-712 domain, bound to this contract and chain so a signature cannot be replayed
    /// onto another deployment.
    bytes32 private immutable _domainSeparator;
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 batchId,uint256 amount,address to)");

    event BatchFunded(
        bytes32 indexed batchId,
        bytes32 root,
        uint256 total,
        uint32 recipientCount,
        uint64 expiresAt
    );

    /**
     * @notice One payment's ECDH hint. Carries no recipient — that is the point.
     * @param ephemeralPubKey Compressed secp256k1 point R, 33 bytes.
     * @param viewTag First byte of the shared secret. Lets a scanning employee reject ~255/256 of
     * announcements with one hash instead of a full point multiplication.
     * @param encryptedAmount The payment amount XORed with a one-time pad derived from the same
     * shared secret. Only the recipient can remove the pad, and they need the amount to rebuild
     * their own Merkle leaf — without this an employee could derive their stealth address from chain
     * data but still not construct a proof, leaving them dependent on the employer's server to claim
     * their own salary. The pad is never reused: the secret is unique per payment.
     */
    event Announcement(
        bytes32 indexed batchId,
        bytes ephemeralPubKey,
        uint8 viewTag,
        bytes32 encryptedAmount
    );

    /**
     * @notice Every leaf in the batch, published so anyone can rebuild the tree.
     * @dev Leaves are `keccak256(abi.encode(stealthAddress, amount))` — preimage-resistant, and the
     * addresses inside are unlinkable anyway, so publishing them reveals nothing. What it buys is
     * self-custody: combined with the decrypted amount from the Announcement, an employee can
     * reconstruct the tree and derive their own proof from chain data alone. The server becomes a
     * convenience rather than a dependency.
     */
    event BatchLeaves(bytes32 indexed batchId, bytes32[] leaves);

    event Claimed(bytes32 indexed batchId, address indexed to, uint256 amount);
    event Reclaimed(bytes32 indexed batchId, address indexed funder, uint256 amount);

    error ZeroAddress();
    error BatchExists();
    error BatchNotFound();
    error AlreadyClaimed();
    error BadProof();
    error BadSignature();
    error InsufficientBatchBalance();
    error NotFunder();
    error NotExpired();
    error NothingToReclaim();
    error InvalidExpiry();

    constructor(address token_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
        _domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MagmosStealthPayout"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
    }

    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    /**
     * @notice Commit a payroll batch and deposit the total.
     * @dev Announcements are emitted in the same transaction so an employee has everything needed to
     * find their payment from chain data alone — no out-of-band message from the employer, which
     * would be both a UX failure and a metadata leak.
     *
     * @param b                Batch id, root, total, recipient count and TTL. Reusing an id reverts
     *                         rather than overwriting a root, which would strip every unclaimed
     *                         recipient of their proof.
     * @param ephemeralPubKeys One compressed point per recipient.
     * @param viewTags         One byte per recipient, same order.
     * @param encryptedAmounts One per recipient, same order. Amount XOR a pad only they can derive.
     * @param leaves           Every leaf, in tree order, so recipients can rebuild their own proofs.
     */
    function fundBatch(
        BatchInput calldata b,
        bytes[] calldata ephemeralPubKeys,
        uint8[] calldata viewTags,
        bytes32[] calldata encryptedAmounts,
        bytes32[] calldata leaves
    ) external nonReentrant {
        if (_batches[b.batchId].exists) revert BatchExists();
        if (b.root == bytes32(0) || b.total == 0) revert BadProof();
        // A batch that expires immediately could be reclaimed before anyone can claim; one that
        // never expires strands funds forever.
        if (b.ttl < 1 days || b.ttl > 365 days) revert InvalidExpiry();

        uint64 expiresAt = uint64(block.timestamp) + b.ttl;
        _batches[b.batchId] = Batch({
            root: b.root,
            total: b.total,
            claimed: 0,
            funder: msg.sender,
            fundedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            recipientCount: b.recipientCount,
            exists: true
        });

        token.safeTransferFrom(msg.sender, address(this), b.total);
        emit BatchFunded(b.batchId, b.root, b.total, b.recipientCount, expiresAt);

        // Split out: emitting inline pushed `fundBatch` past the EVM's 16-slot reach ("stack too
        // deep"). Keeping it in its own frame is cheaper than enabling via-ir for the whole project.
        _announce(b.batchId, ephemeralPubKeys, viewTags, encryptedAmounts);
        // One event rather than one per leaf: a client rebuilding the tree needs them in order and
        // all at once, and a single array is far cheaper than N logs.
        emit BatchLeaves(b.batchId, leaves);
    }

    function _announce(
        bytes32 batchId,
        bytes[] calldata ephemeralPubKeys,
        uint8[] calldata viewTags,
        bytes32[] calldata encryptedAmounts
    ) private {
        uint256 n = ephemeralPubKeys.length;
        for (uint256 i = 0; i < n; ++i) {
            emit Announcement(
                batchId,
                ephemeralPubKeys[i],
                i < viewTags.length ? viewTags[i] : 0,
                i < encryptedAmounts.length ? encryptedAmounts[i] : bytes32(0)
            );
        }
    }

    /**
     * @notice Claim a payment. Callable by anyone; only the stealth key's signature authorises it.
     *
     * @dev The stealth address is *recovered* from the signature rather than passed in, so a caller
     * cannot claim against someone else's leaf. The signature commits to `to`, so a relayer cannot
     * point the money at itself.
     *
     * @param batchId Batch being claimed from.
     * @param amount  Leaf amount. Must match the committed leaf exactly.
     * @param to      Destination. The employee's choice — an exchange, a fresh wallet, anywhere.
     * @param proof   Merkle proof for `keccak256(abi.encode(stealthAddress, amount))`.
     * @param sig     EIP-712 signature by the stealth key over (batchId, amount, to).
     */
    function claim(
        bytes32 batchId,
        uint256 amount,
        address to,
        bytes32[] calldata proof,
        bytes calldata sig
    ) external nonReentrant {
        Batch storage b = _batches[batchId];
        if (!b.exists) revert BatchNotFound();
        if (to == address(0)) revert ZeroAddress();

        bytes32 digest = MessageHashUtils.toTypedDataHash(
            _domainSeparator, keccak256(abi.encode(CLAIM_TYPEHASH, batchId, amount, to))
        );
        (address stealth, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || stealth == address(0)) revert BadSignature();

        bytes32 leaf = keccak256(abi.encode(stealth, amount));
        if (leafClaimed[batchId][leaf]) revert AlreadyClaimed();
        if (!MerkleProof.verify(proof, b.root, leaf)) revert BadProof();

        // Guards against a malformed root whose leaves sum to more than was deposited: the first
        // claimants would drain it and the last would find an empty contract.
        if (b.claimed + amount > b.total) revert InsufficientBatchBalance();

        leafClaimed[batchId][leaf] = true;
        b.claimed += amount;

        emit Claimed(batchId, to, amount);
        token.safeTransfer(to, amount);
    }

    /**
     * @notice After expiry, the funder recovers whatever was never claimed.
     * @dev Only the remainder, and only after the window — an employer must not be able to cancel a
     * salary that is already owed and merely unclaimed.
     */
    function reclaim(bytes32 batchId) external nonReentrant returns (uint256 amount) {
        Batch storage b = _batches[batchId];
        if (!b.exists) revert BatchNotFound();
        if (msg.sender != b.funder) revert NotFunder();
        if (block.timestamp < b.expiresAt) revert NotExpired();

        amount = b.total - b.claimed;
        if (amount == 0) revert NothingToReclaim();

        b.claimed = b.total;
        emit Reclaimed(batchId, msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    /// @notice Convenience for clients building proofs — keeps leaf construction in one place.
    function leafFor(address stealthAddress, uint256 amount) external pure returns (bytes32) {
        return keccak256(abi.encode(stealthAddress, amount));
    }
}
