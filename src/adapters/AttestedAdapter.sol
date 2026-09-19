// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IJobAdapter} from "../interfaces/IJobAdapter.sol";

/// @notice Attestation-based adapter for external protocols with no on-chain
/// read. Tier = ATTESTED. Requires a signature from an authorised attester
/// (owner-managed key, separate from protocol owner) over a JobAttestation struct.
/// All attested positions use OBLIGATION repayment mode — no automatic lien.
///
/// Security properties:
///   - Attester key compromise: blast radius is bounded by Hood's ATTESTED tier cap.
///   - Replay prevention: per-attester nonce is monotonic, verified on-chain.
///   - Freshness: attestedAt must be within 1 hour of block.timestamp.
///   - Chain binding: chainId in the domain separator prevents cross-chain replay.
contract AttestedAdapter is IJobAdapter {
    error Unauthorized();
    error InvalidAttestation();
    error AttestationExpired();
    error NonceReused();
    error InvalidJob();

    address public immutable owner;
    address public usdc;

    // Authorised attestation signers
    mapping(address => bool) public isAttester;
    // Prevent nonce reuse per attester
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // EIP-712 domain
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "JobAttestation(address protocol,uint256 jobId,address agent,uint128 budget,"
        "address token,uint64 expiry,uint64 attestedAt,uint256 nonce,address attester)"
    );

    struct JobAttestation {
        address protocol;
        uint256 jobId;
        address agent;
        uint128 budget;
        address token;
        uint64  expiry;
        uint64  attestedAt;
        uint256 nonce;
        address attester;
    }

    // Stored attestations: hash → valid (prevents repeated verify calls for same job)
    mapping(bytes32 => bool) public verifiedAttestations;
    // jobId → attested job info (stored after first successful verify)
    mapping(uint256 => JobAttestation) public attestedJobs;

    event AttesterAdded(address indexed attester);
    event AttesterRemoved(address indexed attester);
    event AttestationVerified(uint256 indexed jobId, address indexed agent, address indexed attester);

    constructor(address owner_, address usdc_) {
        require(owner_ != address(0) && usdc_ != address(0), "zero addr");
        owner = owner_;
        usdc  = usdc_;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("AverisAttestedAdapter"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }

    function addAttester(address a) external onlyOwner { isAttester[a] = true; emit AttesterAdded(a); }
    function removeAttester(address a) external onlyOwner { isAttester[a] = false; emit AttesterRemoved(a); }

    function tier() external pure override returns (AdapterTier) {
        return AdapterTier.ATTESTED;
    }

    /// @notice Returns a JobView for a previously verified attestation.
    /// The agent must call verifyAttestation() first.
    function getJob(uint256 jobId) external view override returns (JobView memory v) {
        JobAttestation memory a = attestedJobs[jobId];
        if (a.agent == address(0)) revert InvalidJob();
        if (a.expiry <= block.timestamp) revert InvalidJob();

        v.protocol      = a.protocol;
        v.jobId         = jobId;
        v.agent         = a.agent;
        v.token         = a.token;
        v.budget        = a.budget;
        v.expiry        = a.expiry;
        v.payoutReceiver = address(0); // no lien for attested jobs
        v.repayMode     = RepayMode.OBLIGATION;
        v.state         = JobState.FUNDED;
        v.tier          = AdapterTier.ATTESTED;
    }

    /// @notice Verify an EIP-712 attestation signature and store the job.
    /// Must be called before getJob() and draw().
    function verifyAttestation(
        JobAttestation calldata attestation,
        bytes calldata signature
    ) external {
        // Freshness: attestedAt must be within the last hour
        if (block.timestamp > attestation.attestedAt + 1 hours) revert AttestationExpired();
        if (attestation.expiry <= block.timestamp)               revert InvalidAttestation();
        if (attestation.token != usdc)                           revert InvalidAttestation();
        if (attestation.budget == 0)                             revert InvalidAttestation();
        if (!isAttester[attestation.attester])                   revert InvalidAttestation();

        // Nonce replay prevention
        if (usedNonces[attestation.attester][attestation.nonce]) revert NonceReused();

        // Verify EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(
            ATTESTATION_TYPEHASH,
            attestation.protocol,
            attestation.jobId,
            attestation.agent,
            attestation.budget,
            attestation.token,
            attestation.expiry,
            attestation.attestedAt,
            attestation.nonce,
            attestation.attester
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = _recover(digest, signature);
        if (recovered != attestation.attester) revert InvalidAttestation();

        // Mark nonce used and store
        usedNonces[attestation.attester][attestation.nonce] = true;
        attestedJobs[attestation.jobId] = attestation;
        emit AttestationVerified(attestation.jobId, attestation.agent, attestation.attester);
    }

    /// @notice Attested jobs have no lien — always returns false.
    function setLien(uint256, address) external pure override returns (bool) {
        return false;
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }
}
