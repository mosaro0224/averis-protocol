// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal interface ExternalJobAdapter uses to read any ERC-8183-compatible
/// or ACP-compatible job escrow that lives outside the Averis contract set.
/// Only the functions Averis actually calls are declared here; the source contract
/// may implement a superset.
interface IExternalJob {
    enum JobStatus { OPEN, FUNDED, SUBMITTED, COMPLETED, REJECTED, EXPIRED }

    /// @notice Returns the core job fields Averis needs for credit decisions.
    /// @dev Implementations MUST revert when jobId does not exist.
    /// Return values (in order):
    ///   client          — party that funded the job
    ///   provider        — executing agent (receives payout)
    ///   evaluator       — settlement authority
    ///   payoutReceiver  — current payout destination (address(0) = provider)
    ///   token           — ERC-20 settlement token
    ///   budget          — total funded amount
    ///   settledAmount   — cumulative amount already released
    ///   expiry          — job deadline (unix timestamp)
    ///   status          — current canonical state
    function getJob(uint256 jobId)
        external
        view
        returns (
            address client,
            address provider,
            address evaluator,
            address payoutReceiver,
            address token,
            uint128 budget,
            uint128 settledAmount,
            uint64  expiry,
            JobStatus status
        );

    /// @notice Attempt to redirect future payouts to `receiver`.
    /// Called by ExternalJobAdapter.setLien() on behalf of the provider.
    /// If the source contract does not support this, the call will revert
    /// and ExternalJobAdapter catches it to fall back to OBLIGATION mode.
    function setPayoutReceiver(uint256 jobId, address receiver) external;
}
