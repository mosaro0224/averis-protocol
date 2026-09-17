// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The only escrow-specific component. Production adapters must verify
/// an immutable provider payout receiver and escrow funding on the job protocol.
interface IReceivableAdapter {
    enum JobState { NONE, FUNDED, SETTLED, REJECTED, CANCELLED, EXPIRED }
    function job(uint256 jobId) external view returns (
        address provider, address payoutReceiver, uint256 receivable, uint64 expiry, JobState state
    );
}
