// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Universal interface every Averis job adapter must implement.
/// Core financing contracts only ever call getJob() and tier(); setLien() is
/// optional and used only during the draw() setup phase.
interface IJobAdapter {
    enum AdapterTier { NATIVE, VERIFIED, ATTESTED }
    enum JobState    { NONE, FUNDED, SUBMITTED, COMPLETED, REJECTED, EXPIRED }
    enum RepayMode   { LIEN, OBLIGATION }

    struct JobView {
        address protocol;       // source escrow / protocol contract
        uint256 jobId;          // job identifier on the source protocol
        address agent;          // provider / executing agent
        address client;         // job creator
        address token;          // settlement token — must be USDC
        uint128 budget;         // total funded amount (6-decimal USDC)
        uint128 settledAmount;  // cumulative amount already settled
        uint64  expiry;         // unix timestamp of job deadline
        address payoutReceiver; // where settlement funds are sent
        RepayMode repayMode;    // LIEN (automatic) or OBLIGATION (agent-signed)
        JobState  state;        // current canonical state
        AdapterTier tier;       // risk tier assigned by the registry
    }

    /// @notice Canonical job view. MUST revert if jobId does not exist.
    /// MUST be side-effect free (view).
    function getJob(uint256 jobId) external view returns (JobView memory);

    /// @notice Returns this adapter's risk tier.
    function tier() external view returns (AdapterTier);

    /// @notice Attempt to wire ReceivableRouter as payout receiver on the
    /// source protocol. Called by the agent (via the adapter) before draw().
    /// Returns true on success, false when the source protocol does not
    /// support receiver mutation (caller falls back to OBLIGATION mode).
    /// MUST NOT revert on unsupported protocols — return false instead.
    function setLien(uint256 jobId, address router) external returns (bool);
}
