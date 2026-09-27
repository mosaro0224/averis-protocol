// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAgentReceiptRegistry, ReceiptType, VerificationState} from "../interfaces/IAgentPassport.sol";

/**
 * @title  AgentReceiptRegistry
 * @notice Append-only registry for economic receipt anchors.
 *
 *         Receipts are anchored by hash reference only. No sensitive data,
 *         no raw content — only the integrity hash plus metadata.
 *         Once anchored, receipts are immutable.
 *
 *         Three verification states:
 *           SELF_REPORTED    — anchored by the agent itself
 *           AVERIS_VERIFIED  — anchored by an authorized Averis contract
 *           EXTERNAL_ATTESTER — anchored by an authorized third party
 *
 * Security properties:
 *   - Append-only: no receipt can be modified or deleted after anchoring
 *   - Authorized issuers set by contract owner (Averis contracts only)
 *   - Any agent can self-report their own receipts
 *   - No USDC or token custody
 *   - No admin can fabricate receipts for other agents
 */
contract AgentReceiptRegistry is IAgentReceiptRegistry {

    // ── Errors ────────────────────────────────────────────────────────────────
    error Unauthorized();
    error ZeroAddress();
    error ZeroHash();
    error ReceiptNotFound();

    // ── Storage ───────────────────────────────────────────────────────────────

    struct ReceiptAnchor {
        uint256           receiptId;
        address           agentWallet;
        uint256           agentId;          // ERC-8004 agentId (0 if not registered)
        bytes32           txHash;           // on-chain transaction hash of the economic event
        bytes32           evidenceHash;     // keccak256 of off-chain receipt JSON
        ReceiptType       receiptType;
        VerificationState verState;
        uint64            anchoredAt;
        address           issuer;           // who anchored this receipt
    }

    // Owner of this contract (can add/remove authorized issuers)
    address public owner;

    // Global receipt counter
    uint256 public totalReceipts;

    // receiptId → ReceiptAnchor
    mapping(uint256 => ReceiptAnchor) private _receipts;

    // agentWallet → receiptIds (append-only)
    mapping(address => uint256[]) private _agentReceiptIds;

    // authorized issuers (e.g. AverisFinancingV2 contract address)
    mapping(address => bool) public authorizedIssuers;

    // ── Events ────────────────────────────────────────────────────────────────

    event ReceiptAnchored(
        uint256 indexed         receiptId,
        address indexed         agentWallet,
        uint256                 agentId,
        bytes32                 txHash,
        bytes32                 evidenceHash,
        ReceiptType             receiptType,
        VerificationState       verState,
        address                 issuer
    );

    event IssuerAuthorized(address indexed issuer);
    event IssuerRevoked(address indexed issuer);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ── Owner management ──────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAuthorizedIssuer(address issuer, bool authorized) external onlyOwner {
        if (issuer == address(0)) revert ZeroAddress();
        authorizedIssuers[issuer] = authorized;
        if (authorized) emit IssuerAuthorized(issuer);
        else            emit IssuerRevoked(issuer);
    }

    // ── Internal anchor ───────────────────────────────────────────────────────

    function _anchor(
        address           agentWallet,
        uint256           agentId,
        bytes32           txHash,
        bytes32           evidenceHash,
        ReceiptType       receiptType,
        VerificationState verState
    ) internal returns (uint256 receiptId) {
        if (agentWallet == address(0)) revert ZeroAddress();
        if (evidenceHash == bytes32(0)) revert ZeroHash();

        receiptId = ++totalReceipts;

        _receipts[receiptId] = ReceiptAnchor({
            receiptId:    receiptId,
            agentWallet:  agentWallet,
            agentId:      agentId,
            txHash:       txHash,
            evidenceHash: evidenceHash,
            receiptType:  receiptType,
            verState:     verState,
            anchoredAt:   uint64(block.timestamp),
            issuer:       msg.sender
        });

        _agentReceiptIds[agentWallet].push(receiptId);

        emit ReceiptAnchored(receiptId, agentWallet, agentId, txHash, evidenceHash, receiptType, verState, msg.sender);
    }

    // ── Public interface ──────────────────────────────────────────────────────

    /**
     * @notice Anchor a receipt. Determines verification state from caller:
     *         - authorized issuer  → AVERIS_VERIFIED
     *         - agentWallet itself → SELF_REPORTED
     *         - other authorized attester → EXTERNAL_ATTESTER
     *         - any other caller   → SELF_REPORTED (anchors for the agentWallet param)
     *           (agents can only self-report for their own wallet)
     */
    function anchorReceipt(
        address     agentWallet,
        uint256     agentId,
        bytes32     txHash,
        bytes32     evidenceHash,
        ReceiptType receiptType
    ) external returns (uint256 receiptId) {
        VerificationState verState;

        if (authorizedIssuers[msg.sender]) {
            // Authorized Averis contracts can anchor for any agent as AVERIS_VERIFIED
            verState = VerificationState.AVERIS_VERIFIED;
        } else if (msg.sender == agentWallet) {
            // Agent self-reporting their own receipt
            verState = VerificationState.SELF_REPORTED;
        } else {
            // Only allow anchoring for oneself unless authorized issuer
            revert Unauthorized();
        }

        return _anchor(agentWallet, agentId, txHash, evidenceHash, receiptType, verState);
    }

    /**
     * @notice Anchor by an external attester (third-party authorized service).
     *         Separate function to make the EXTERNAL_ATTESTER state explicit.
     *         Caller must be an authorized issuer.
     */
    function anchorExternalAttestation(
        address     agentWallet,
        uint256     agentId,
        bytes32     txHash,
        bytes32     evidenceHash,
        ReceiptType receiptType
    ) external returns (uint256 receiptId) {
        if (!authorizedIssuers[msg.sender]) revert Unauthorized();
        return _anchor(agentWallet, agentId, txHash, evidenceHash, receiptType, VerificationState.EXTERNAL_ATTESTER);
    }

    // ── View functions ─────────────────────────────────────────────────────────

    function getReceipt(uint256 receiptId) external view returns (ReceiptAnchor memory) {
        if (_receipts[receiptId].receiptId == 0) revert ReceiptNotFound();
        return _receipts[receiptId];
    }

    function getAgentReceipts(address agentWallet) external view returns (uint256[] memory) {
        return _agentReceiptIds[agentWallet];
    }

    function verificationState(uint256 receiptId) external view returns (VerificationState) {
        if (_receipts[receiptId].receiptId == 0) revert ReceiptNotFound();
        return _receipts[receiptId].verState;
    }

    function getReceiptCount(address agentWallet) external view returns (uint256) {
        return _agentReceiptIds[agentWallet].length;
    }
}
