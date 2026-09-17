// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IAverisACP {
    enum JobStatus { NONE, OPEN, FUNDED, SUBMITTED, COMPLETED, REJECTED, EXPIRED }
    function getJob(uint256 jobId) external view returns (
        address client, address provider, address evaluator, address payoutReceiver, address token,
        uint128 budget, uint128 settledAmount, uint64 expiry, JobStatus status
    );
}
