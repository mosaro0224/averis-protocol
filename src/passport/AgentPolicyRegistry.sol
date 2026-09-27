// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAgentPolicyRegistry} from "../interfaces/IAgentPassport.sol";

/**
 * @title  AgentPolicyRegistry
 * @notice Non-custodial registry for agent economic policies.
 *
 *         Each agent commits a policy (hash of off-chain JSON document +
 *         optional content URI hash) via EIP-712 signature. Policies are
 *         versioned, revocable, and transferable. No funds are held here.
 *
 *         Identity is referenced via the canonical ERC-8004 IdentityRegistry
 *         on each chain. No competing identity registry is created.
 *
 * Security properties:
 *   - EIP-712 domain separation from AverisProtocol v2 (different name + contract)
 *   - Per-agent monotonic nonce (replay protection)
 *   - deadline enforcement (expiry protection)
 *   - No admin can commit/revoke on behalf of an agent
 *   - Historical policy events are permanent (append-only event log)
 *   - No sensitive data stored on-chain (hashes only)
 */
contract AgentPolicyRegistry is IAgentPolicyRegistry {

    // ── Errors ────────────────────────────────────────────────────────────────
    error Unauthorized();
    error PolicyNotFound();
    error PolicyAlreadyRevoked();
    error DeadlineExpired();
    error NonceReused();
    error InvalidSignature();
    error ZeroAddress();
    error InvalidPolicyHash();

    // ── EIP-712 ───────────────────────────────────────────────────────────────
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant POLICY_TYPEHASH = keccak256(
        "PolicyCommitment(address agentWallet,uint256 agentId,address identityRegistry,"
        "bytes32 policyHash,bytes32 contentURI,uint64 expiresAt,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant REVOKE_TYPEHASH = keccak256(
        "PolicyRevocation(address agentWallet,uint256 policyId,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "PolicyTransfer(address agentWallet,uint256 policyId,address newOwner,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant LINK_TYPEHASH = keccak256(
        "IdentityLink(address agentWallet,uint256 chainId,address registryAddress,uint256 agentId,uint256 nonce,uint256 deadline)"
    );

    // ── Storage ───────────────────────────────────────────────────────────────

    struct Policy {
        uint256  policyId;
        uint256  version;           // increments on each update
        address  agentWallet;       // current owner of this policy
        uint256  agentId;           // ERC-8004 agentId (0 if not registered on this chain)
        address  identityRegistry;  // canonical ERC-8004 IdentityRegistry address
        bytes32  policyHash;        // keccak256 of off-chain policy JSON
        bytes32  contentURI;        // keccak256 of IPFS/HTTPS URI (not the URI itself)
        uint64   createdAt;
        uint64   updatedAt;
        uint64   expiresAt;         // 0 = no expiry
        bool     revoked;
    }

    struct IdentityLink {
        uint256 chainId;
        address registryAddress;
        uint256 agentId;
        address wallet;
        uint64  linkedAt;
        bytes32 linkTxHash;         // tx.hash of the linkIdentity call (set to 0 in simulation)
    }

    // Global policy counter
    uint256 public totalPolicies;

    // policyId → Policy
    mapping(uint256 => Policy) public policies;

    // agentWallet → array of policyIds
    mapping(address => uint256[]) private _agentPolicyIds;

    // EIP-712 nonces per agent wallet
    mapping(address => uint256) public nonces;

    // agentWallet → array of linked identities
    mapping(address => IdentityLink[]) private _agentIdentityLinks;

    // ── Events ────────────────────────────────────────────────────────────────

    event PolicyCommitted(
        address indexed agentWallet,
        uint256 indexed policyId,
        uint256         version,
        bytes32         policyHash,
        bytes32         contentURI,
        uint256         agentId,
        address         identityRegistry,
        uint64          expiresAt
    );

    event PolicyRevoked(
        address indexed agentWallet,
        uint256 indexed policyId
    );

    event PolicyOwnerTransferred(
        uint256 indexed policyId,
        address indexed from,
        address indexed to
    );

    event IdentityLinked(
        address indexed agentWallet,
        uint256         chainId,
        address         registryAddress,
        uint256         agentId
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("AverisPassport"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _hashPolicy(
        address  agentWallet,
        uint256  agentId,
        address  identityRegistry,
        bytes32  policyHash,
        bytes32  contentURI,
        uint64   expiresAt,
        uint256  nonce,
        uint256  deadline
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                POLICY_TYPEHASH,
                agentWallet,
                agentId,
                identityRegistry,
                policyHash,
                contentURI,
                expiresAt,
                nonce,
                deadline
            ))
        ));
    }

    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }

    function _commitPolicyInternal(
        address  agentWallet,
        bytes32  policyHash,
        bytes32  contentURI,
        uint64   expiresAt,
        uint256  agentId,
        address  identityRegistry
    ) internal returns (uint256 policyId) {
        if (policyHash == bytes32(0)) revert InvalidPolicyHash();

        policyId = ++totalPolicies;

        policies[policyId] = Policy({
            policyId:         policyId,
            version:          1,
            agentWallet:      agentWallet,
            agentId:          agentId,
            identityRegistry: identityRegistry,
            policyHash:       policyHash,
            contentURI:       contentURI,
            createdAt:        uint64(block.timestamp),
            updatedAt:        uint64(block.timestamp),
            expiresAt:        expiresAt,
            revoked:          false
        });

        _agentPolicyIds[agentWallet].push(policyId);

        emit PolicyCommitted(agentWallet, policyId, 1, policyHash, contentURI, agentId, identityRegistry, expiresAt);
    }

    // ── Public interface ──────────────────────────────────────────────────────

    /// @notice Commit a policy directly (msg.sender is the agent).
    function commitPolicy(
        bytes32  policyHash,
        bytes32  contentURI,
        uint64   expiresAt,
        uint256  agentId,
        address  identityRegistry
    ) external returns (uint256 policyId) {
        return _commitPolicyInternal(msg.sender, policyHash, contentURI, expiresAt, agentId, identityRegistry);
    }

    /// @notice Commit a policy via EIP-712 signature (meta-transaction).
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
    ) external returns (uint256 policyId) {
        if (agentWallet == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (nonces[agentWallet] != nonce) revert NonceReused();

        bytes32 digest = _hashPolicy(agentWallet, agentId, identityRegistry, policyHash, contentURI, expiresAt, nonce, deadline);
        address recovered = _recoverSigner(digest, signature);
        if (recovered == address(0) || recovered != agentWallet) revert InvalidSignature();

        nonces[agentWallet]++;
        return _commitPolicyInternal(agentWallet, policyHash, contentURI, expiresAt, agentId, identityRegistry);
    }

    /// @notice Revoke a policy permanently. Only the current owner can revoke.
    function revokePolicy(uint256 policyId) external {
        Policy storage p = policies[policyId];
        if (p.policyId == 0) revert PolicyNotFound();
        if (p.agentWallet != msg.sender) revert Unauthorized();
        if (p.revoked) revert PolicyAlreadyRevoked();
        p.revoked = true;
        p.updatedAt = uint64(block.timestamp);
        emit PolicyRevoked(msg.sender, policyId);
    }

    /// @notice Transfer policy ownership. Only current owner can transfer.
    function transferPolicyOwner(uint256 policyId, address newOwner) external {
        if (newOwner == address(0)) revert ZeroAddress();
        Policy storage p = policies[policyId];
        if (p.policyId == 0) revert PolicyNotFound();
        if (p.agentWallet != msg.sender) revert Unauthorized();
        if (p.revoked) revert PolicyAlreadyRevoked();

        address old = p.agentWallet;
        p.agentWallet = newOwner;
        p.updatedAt   = uint64(block.timestamp);

        // Add to new owner's list
        _agentPolicyIds[newOwner].push(policyId);

        emit PolicyOwnerTransferred(policyId, old, newOwner);
    }

    /// @notice Link a cross-chain identity to the caller's passport.
    function linkIdentity(
        uint256 chainId,
        address registryAddress,
        uint256 agentId
    ) external {
        _agentIdentityLinks[msg.sender].push(IdentityLink({
            chainId:         chainId,
            registryAddress: registryAddress,
            agentId:         agentId,
            wallet:          msg.sender,
            linkedAt:        uint64(block.timestamp),
            linkTxHash:      bytes32(0)
        }));
        emit IdentityLinked(msg.sender, chainId, registryAddress, agentId);
    }

    // ── View functions ─────────────────────────────────────────────────────────

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function getAgentPolicies(address agentWallet) external view returns (uint256[] memory) {
        return _agentPolicyIds[agentWallet];
    }

    function getAgentIdentityLinks(address agentWallet) external view returns (IdentityLink[] memory) {
        return _agentIdentityLinks[agentWallet];
    }

    function isPolicyValid(uint256 policyId) external view returns (bool) {
        Policy storage p = policies[policyId];
        if (p.policyId == 0 || p.revoked) return false;
        if (p.expiresAt != 0 && block.timestamp > p.expiresAt) return false;
        return true;
    }
}
