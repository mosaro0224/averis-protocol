// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IJobAdapter} from "../interfaces/IJobAdapter.sol";
import {IAverisACP} from "../interfaces/IAverisACP.sol";

/// @dev Extended ACP interface that also exposes the lien-setting function.
interface IAverisACPFull is IAverisACP {
    function setPayoutReceiver(uint256 jobId, address receiver) external;
}

/// @notice Native Averis adapter — wraps AverisACP into IJobAdapter.
/// Tier = NATIVE. All jobs financed through this adapter have a confirmed
/// on-chain lien (payoutReceiver == router before draw).
contract AverisACPAdapter is IJobAdapter {
    error InvalidJob();

    IAverisACPFull public immutable acp;
    address    public immutable router;

    constructor(IAverisACPFull acp_, address router_) {
        require(address(acp_) != address(0) && router_ != address(0), "zero addr");
        acp    = acp_;
        router = router_;
    }

    function tier() external pure override returns (AdapterTier) {
        return AdapterTier.NATIVE;
    }

    /// @notice Map AverisACP job state to canonical JobView.
    /// Reverts if the job does not exist (provider == address(0))
    /// or is in a terminal/unusable state for financing.
    function getJob(uint256 jobId) external view override returns (JobView memory v) {
        (
            address client,
            address provider,
            ,           // evaluator — not needed in JobView
            address payoutReceiver,
            address token,
            uint128 budget,
            uint128 settledAmount,
            uint64  expiry,
            IAverisACP.JobStatus status
        ) = acp.getJob(jobId);

        if (provider == address(0)) revert InvalidJob();

        v.protocol      = address(acp);
        v.jobId         = jobId;
        v.agent         = provider;
        v.client        = client;
        v.token         = token;
        v.budget        = budget;
        v.settledAmount = settledAmount;
        v.expiry        = expiry;
        v.payoutReceiver = payoutReceiver;
        v.tier          = AdapterTier.NATIVE;

        // Map status
        if (status == IAverisACP.JobStatus.FUNDED)    v.state = JobState.FUNDED;
        else if (status == IAverisACP.JobStatus.SUBMITTED) v.state = JobState.SUBMITTED;
        else if (status == IAverisACP.JobStatus.COMPLETED) v.state = JobState.COMPLETED;
        else if (status == IAverisACP.JobStatus.REJECTED)  v.state = JobState.REJECTED;
        else if (status == IAverisACP.JobStatus.EXPIRED)   v.state = JobState.EXPIRED;
        else v.state = JobState.NONE;

        // Native jobs always use LIEN mode; router must be the payout receiver
        v.repayMode = (payoutReceiver == router) ? RepayMode.LIEN : RepayMode.OBLIGATION;
    }

    /// @notice Wire the ReceivableRouter as payout receiver.
    /// Only works while job is still OPEN (pre-funding).
    /// Returns false (instead of reverting) if not in OPEN state,
    /// so the caller can fall through to OBLIGATION mode.
    function setLien(uint256 jobId, address router_) external override returns (bool) {
        try acp.setPayoutReceiver(jobId, router_) {
            return true;
        } catch {
            return false;
        }
    }
}
