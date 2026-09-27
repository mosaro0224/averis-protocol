// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared types and interfaces for the Agent Economic Passport.
///         The Passport is a non-custodial identity/policy/receipt layer;
///         all fund custody remains in the Averis Bank contracts.

// ── Receipt type enum ──────────────────────────────────────────────────────

enum ReceiptType {
    JOB_PAYMENT,        // 0 — payment received for a completed job
    FINANCING,          // 1 — Averis working capital draw
    CREDIT_REPAYMENT,   // 2 — repayment of Averis financing
    ESCROW,             // 3 — funds placed in escrow
    REFUND,             // 4 — refund received
    API_PURCHASE,       // 5 — API call payment
    COMPUTE_PURCHASE,   // 6 — compute resource payment
    AGENT_PAYMENT,      // 7 — agent-to-agent payment
    TRADING,            // 8 — on-chain trading
    OTHER               // 9 — other economic activity
}

// ── Verification state enum ────────────────────────────────────────────────

enum VerificationState {
    SELF_REPORTED,      // 0 — anchored by the agent itself (unverified)
    AVERIS_VERIFIED,    // 1 — anchored by an authorized Averis contract
    EXTERNAL_ATTESTER  // 2 — anchored by a third-party authorized attester
}

// ── Cross-chain identity reference ────────────────────────────────────────

struct AgentIdentityRef {
    uint256 chainId;
    address registryAddress;   // canonical ERC-8004 IdentityRegistry on that chain
    uint256 agentId;           // tokenId from ownerOf() on that registry
    address wallet;            // verified wallet of the agent
}

// ── IAgentPolicyRegistry ──────────────────────────────────────────────────

interface IAgentPolicyRegistry {
    /// @notice Commit a new versioned policy for msg.sender.
    function commitPolicy(
        bytes32  policyHash,
        bytes32  contentURI,
        uint64   expiresAt,
        uint256  agentId,
        address  identityRegistry
    ) external returns (uint256 policyId);

    /// @notice Commit a policy on behalf of agentWallet using EIP-712 sig.
    function commitPolicyFor(
        address  agentWallet,
        bytes32  policyHash,
        bytes32  contentURI,
        uint64   expiresAt,
        uint256  agentId,
        address  identityRegistry,
        uint256  nonce,
        uint256  deadline,
        bytes    calldata signature
    ) external returns (uint256 policyId);

    /// @notice Revoke a policy permanently. Cannot be undone.
    function revokePolicy(uint256 policyId) external;

    /// @notice Transfer ownership of a policy to a new wallet.
    function transferPolicyOwner(uint256 policyId, address newOwner) external;

    /// @notice Link a cross-chain identity to the caller's passport.
    function linkIdentity(
        uint256 chainId,
        address registryAddress,
        uint256 agentId
    ) external;

    /// @notice Returns the current nonce for an agent wallet.
    function nonces(address agentWallet) external view returns (uint256);
}

// ── IAgentReceiptRegistry ─────────────────────────────────────────────────

interface IAgentReceiptRegistry {
    /// @notice Anchor a receipt. Returns the global receiptId.
    function anchorReceipt(
        address        agentWallet,
        uint256        agentId,
        bytes32        txHash,
        bytes32        evidenceHash,
        ReceiptType    receiptType
    ) external returns (uint256 receiptId);

    /// @notice Returns the verification state of a receipt.
    function verificationState(uint256 receiptId) external view returns (VerificationState);
}

// ── Future stubs (not implemented in V1) ─────────────────────────────────

interface IAgentReputation {
    /// @notice Aggregate reputation evidence for an agent. Off-chain derived.
    function getReputation(address agentWallet) external view returns (bytes memory);
}

interface IAgentAgreementRegistry {
    /// @notice Anchor an economic agreement hash. Off-chain content.
    function anchorAgreement(address agentWallet, bytes32 agreementHash) external returns (uint256 agreementId);
}

interface IAgentRiskRegistry {
    /// @notice Returns the risk tier for an agent. Off-chain model output.
    function getRiskTier(address agentWallet) external view returns (uint8 tier);
}
