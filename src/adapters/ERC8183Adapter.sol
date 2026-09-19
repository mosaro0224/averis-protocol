// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IJobAdapter} from "../interfaces/IJobAdapter.sol";

/// @notice External ERC-8183 compatible job protocol adapter. Tier = VERIFIED.
/// Reads job state from any contract that exposes the ERC-8183 getJob() signature.
/// Attempts a LIEN via setPayoutReceiver(); falls back to OBLIGATION if unsupported.
interface IERC8183Escrow {
    enum JobStatus { NONE, OPEN, FUNDED, SUBMITTED, COMPLETED, REJECTED, EXPIRED }
    function getJob(uint256 jobId) external view returns (
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
    // Optional — not all ERC-8183 deployments expose this
    function setPayoutReceiver(uint256 jobId, address receiver) external;
}

contract ERC8183Adapter is IJobAdapter {
    error InvalidJob();

    IERC8183Escrow public immutable escrow;
    address        public immutable router;
    address        public immutable usdc;   // only USDC-denominated jobs supported

    constructor(address escrow_, address router_, address usdc_) {
        require(escrow_ != address(0) && router_ != address(0) && usdc_ != address(0), "zero addr");
        escrow = IERC8183Escrow(escrow_);
        router = router_;
        usdc   = usdc_;
    }

    function tier() external pure override returns (AdapterTier) {
        return AdapterTier.VERIFIED;
    }

    function getJob(uint256 jobId) external view override returns (JobView memory v) {
        (
            address client,
            address provider,
            ,
            address payoutReceiver,
            address token,
            uint128 budget,
            uint128 settledAmount,
            uint64  expiry,
            IERC8183Escrow.JobStatus status
        ) = escrow.getJob(jobId);

        // Hard validation — revert on any unusable state
        if (provider == address(0))                                revert InvalidJob();
        if (token != usdc)                                          revert InvalidJob();
        if (budget == 0)                                            revert InvalidJob();
        if (expiry <= block.timestamp)                              revert InvalidJob();
        if (status != IERC8183Escrow.JobStatus.FUNDED &&
            status != IERC8183Escrow.JobStatus.SUBMITTED)          revert InvalidJob();

        v.protocol       = address(escrow);
        v.jobId          = jobId;
        v.agent          = provider;
        v.client         = client;
        v.token          = token;
        v.budget         = budget;
        v.settledAmount  = settledAmount;
        v.expiry         = expiry;
        v.payoutReceiver = payoutReceiver;
        v.tier           = AdapterTier.VERIFIED;

        if (status == IERC8183Escrow.JobStatus.FUNDED)    v.state = JobState.FUNDED;
        else if (status == IERC8183Escrow.JobStatus.SUBMITTED) v.state = JobState.SUBMITTED;
        else if (status == IERC8183Escrow.JobStatus.COMPLETED) v.state = JobState.COMPLETED;
        else if (status == IERC8183Escrow.JobStatus.REJECTED)  v.state = JobState.REJECTED;
        else if (status == IERC8183Escrow.JobStatus.EXPIRED)   v.state = JobState.EXPIRED;
        else v.state = JobState.NONE;

        v.repayMode = (payoutReceiver == router) ? RepayMode.LIEN : RepayMode.OBLIGATION;
    }

    /// @notice Attempt to set ReceivableRouter as payout receiver.
    /// Catches revert from external call and returns false instead.
    function setLien(uint256 jobId, address router_) external override returns (bool) {
        try escrow.setPayoutReceiver(jobId, router_) {
            return true;
        } catch {
            return false;
        }
    }
}
