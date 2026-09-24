// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IJobAdapter}   from "./interfaces/IJobAdapter.sol";
import {IExternalJob}  from "./interfaces/IExternalJob.sol";

/// @notice IJobAdapter implementation for jobs that live on external platforms.
///
/// Trust model:
///   1. Owner maintains a whitelist of approved external job platforms
///      (addPlatform / removePlatform).
///   2. For each job, the adapter reads state directly from the source contract
///      via IExternalJob — no oracle, no off-chain signature required.
///   3. LIEN mode: setLien() calls setPayoutReceiver() on the source contract
///      (succeeds when the provider has not yet locked the receiver).
///      If that call reverts, setLien() returns false and AverisFinancingV2
///      falls back to OBLIGATION mode automatically.
///
/// Limitations (current version):
///   • Source contract must expose a getJob() compatible with IExternalJob.
///   • Source contract must use 6-decimal USDC as the settlement token.
///   • One-address-per-platform: a platform is identified by its contract address
///     and adapterId (adapterId=0 for single-contract platforms).

contract ExternalJobAdapter is IJobAdapter {
    // ── Errors ────────────────────────────────────────────────────────────────
    error Unauthorized();
    error PlatformNotWhitelisted();
    error PlatformAlreadyWhitelisted();
    error ZeroAddress();
    error JobNotEligible();

    // ── State ─────────────────────────────────────────────────────────────────
    address public immutable owner;
    address public immutable usdc;   // expected settlement token on this chain

    /// @dev platform contract address => whitelisted
    mapping(address => bool) public whitelisted;

    // jobId namespace is global across all platforms for this adapter instance.
    // To support multiple platforms with overlapping job IDs, deploy one
    // ExternalJobAdapter per platform and register each separately.
    address public platform; // single platform this instance is scoped to

    // ── Events ────────────────────────────────────────────────────────────────
    event PlatformSet(address indexed platform_);
    event PlatformRemoved(address indexed platform_);
    event LienAttempted(uint256 indexed jobId, bool success);

    constructor(address owner_, address usdc_, address platform_) {
        if (owner_ == address(0) || usdc_ == address(0) || platform_ == address(0))
            revert ZeroAddress();
        owner    = owner_;
        usdc     = usdc_;
        platform = platform_;
        whitelisted[platform_] = true;
        emit PlatformSet(platform_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ── Platform management ───────────────────────────────────────────────────

    /// @notice Replace the scoped platform with a new address.
    /// Deploy a new ExternalJobAdapter instance for each distinct platform.
    function setPlatform(address platform_) external onlyOwner {
        if (platform_ == address(0)) revert ZeroAddress();
        address old = platform;
        whitelisted[old] = false;
        platform = platform_;
        whitelisted[platform_] = true;
        emit PlatformRemoved(old);
        emit PlatformSet(platform_);
    }

    // ── IJobAdapter ───────────────────────────────────────────────────────────

    /// @inheritdoc IJobAdapter
    function tier() external pure override returns (AdapterTier) {
        // External jobs are ATTESTED tier — lowest Hood cap, highest scrutiny.
        // Owner can override the tier in AverisAdapterRegistry without redeploying.
        return AdapterTier.ATTESTED;
    }

    /// @inheritdoc IJobAdapter
    function getJob(uint256 jobId) external view override returns (JobView memory jv) {
        if (!whitelisted[platform]) revert PlatformNotWhitelisted();

        (
            address client,
            address provider,
            ,               // evaluator — not used in JobView
            address payoutReceiver,
            address token,
            uint128 budget,
            uint128 settledAmount,
            uint64  expiry,
            IExternalJob.JobStatus status
        ) = IExternalJob(platform).getJob(jobId);

        jv.protocol       = platform;
        jv.jobId          = jobId;
        jv.agent          = provider;
        jv.client         = client;
        jv.token          = token;
        jv.budget         = budget;
        jv.settledAmount  = settledAmount;
        jv.expiry         = expiry;
        jv.payoutReceiver = payoutReceiver;
        jv.tier           = AdapterTier.ATTESTED;

        // Map external status to IJobAdapter.JobState
        if      (status == IExternalJob.JobStatus.FUNDED)    jv.state = JobState.FUNDED;
        else if (status == IExternalJob.JobStatus.SUBMITTED)  jv.state = JobState.SUBMITTED;
        else if (status == IExternalJob.JobStatus.COMPLETED)  jv.state = JobState.COMPLETED;
        else if (status == IExternalJob.JobStatus.REJECTED)   jv.state = JobState.REJECTED;
        else if (status == IExternalJob.JobStatus.EXPIRED)    jv.state = JobState.EXPIRED;
        else                                                   jv.state = JobState.NONE;

        // Token must be USDC on this chain for Averis to accept it.
        // Repay mode is determined at draw time by whether setLien succeeds;
        // default to LIEN here — AverisFinancingV2 will override if setLien fails.
        jv.repayMode = (token == usdc) ? RepayMode.LIEN : RepayMode.OBLIGATION;
    }

    /// @inheritdoc IJobAdapter
    /// @dev Called by the agent (msg.sender = provider) before draw().
    /// Attempts to wire `router` as payoutReceiver on the source contract.
    /// Returns false (never reverts) if the source contract does not support it,
    /// so AverisFinancingV2 can silently fall back to OBLIGATION mode.
    function setLien(uint256 jobId, address router) external override returns (bool) {
        if (!whitelisted[platform]) return false;
        try IExternalJob(platform).setPayoutReceiver(jobId, router) {
            emit LienAttempted(jobId, true);
            return true;
        } catch {
            emit LienAttempted(jobId, false);
            return false;
        }
    }
}
