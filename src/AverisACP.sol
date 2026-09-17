// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IAverisACP} from "./interfaces/IAverisACP.sol";
import {IDisburser} from "./interfaces/IDisburser.sol";

/// @notice ERC-8183-compatible job escrow with an immutable-at-funding
/// provider-side payout receiver. It is the source of truth for a receivable.
contract AverisACP is IAverisACP {
    using SafeTransfer for IERC20;
    error Unauthorized(); error InvalidState(); error InvalidJob(); error InvalidReceiver(); error InvalidAmount(); error Reentrancy();
    struct Job {
        address client; address provider; address evaluator; address payoutReceiver; IERC20 token;
        uint128 budget; uint128 settledAmount; uint64 expiry; JobStatus status;
    }
    uint256 public nextJobId = 1;
    mapping(uint256 => Job) private jobs;
    uint256 private unlocked = 1;
    event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint64 expiry, string description);
    event PayoutReceiverSet(uint256 indexed jobId, address indexed receiver);
    event BudgetSet(uint256 indexed jobId, address token, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, bytes32 deliverable);
    event ProviderPayout(uint256 indexed jobId, address indexed receiver, uint256 amount);
    event JobCompleted(uint256 indexed jobId, bytes32 reason); event JobRejected(uint256 indexed jobId, bytes32 reason); event JobExpired(uint256 indexed jobId);
    modifier nonReentrant() { if (unlocked != 1) revert Reentrancy(); unlocked = 2; _; unlocked = 1; }

    /// @dev Fifth argument preserves the common ERC-8183 call shape. Hooks are
    /// deliberately unsupported: the escrow itself owns settlement policy.
    function createJob(address provider, address evaluator, uint64 expiry, string calldata description, address hook) external returns (uint256 jobId) {
        if (provider == address(0) || evaluator == address(0) || provider == msg.sender || provider == evaluator || expiry <= block.timestamp || hook != address(0)) revert InvalidJob();
        jobId = nextJobId++; jobs[jobId] = Job(msg.sender, provider, evaluator, address(0), IERC20(address(0)), 0, 0, expiry, JobStatus.OPEN);
        emit JobCreated(jobId, msg.sender, provider, evaluator, expiry, description);
    }
    /// @notice Only the provider may scope its future receivable. This setting
    /// becomes immutable as soon as the client funds the job.
    function setPayoutReceiver(uint256 jobId, address receiver) external {
        Job storage j = jobs[jobId]; if (j.status != JobStatus.OPEN || msg.sender != j.provider || receiver == address(this)) revert Unauthorized();
        j.payoutReceiver = receiver; emit PayoutReceiverSet(jobId, receiver);
    }
    function setBudget(uint256 jobId, address token, uint128 amount, bytes calldata) external {
        Job storage j = jobs[jobId]; if (j.status != JobStatus.OPEN || msg.sender != j.provider || token == address(0) || amount == 0 || block.timestamp >= j.expiry) revert InvalidJob();
        j.token = IERC20(token); j.budget = amount; emit BudgetSet(jobId, token, amount);
    }
    function fund(uint256 jobId, address expectedToken, uint128 expectedBudget, bytes calldata) external nonReentrant {
        Job storage j = jobs[jobId]; if (j.status != JobStatus.OPEN || msg.sender != j.client || address(j.token) != expectedToken || j.budget != expectedBudget || block.timestamp >= j.expiry) revert InvalidJob();
        uint256 beforeBalance = j.token.balanceOf(address(this)); j.token.safeTransferFrom(msg.sender, address(this), j.budget);
        if (j.token.balanceOf(address(this)) != beforeBalance + j.budget) revert InvalidAmount();
        j.status = JobStatus.FUNDED; emit JobFunded(jobId, msg.sender, j.budget);
    }
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata) external {
        Job storage j = jobs[jobId]; if (j.status != JobStatus.FUNDED || msg.sender != j.provider || block.timestamp >= j.expiry) revert InvalidJob();
        j.status = JobStatus.SUBMITTED; emit JobSubmitted(jobId, deliverable);
    }
    /// @notice Allows evaluator-approved partial receivable releases. Amount is cumulative.
    function settleClaim(uint256 jobId, uint128 cumulativeAmount, bytes32 reason) external nonReentrant {
        Job storage j = jobs[jobId]; if (j.status != JobStatus.SUBMITTED || msg.sender != j.evaluator || block.timestamp >= j.expiry || cumulativeAmount <= j.settledAmount || cumulativeAmount > j.budget) revert InvalidJob();
        uint256 delta = cumulativeAmount - j.settledAmount; j.settledAmount = cumulativeAmount;
        if (cumulativeAmount == j.budget) { j.status = JobStatus.COMPLETED; emit JobCompleted(jobId, reason); }
        _release(j, jobId, delta, this.settleClaim.selector);
    }
    function complete(uint256 jobId, bytes32 reason, bytes calldata) external nonReentrant {
        Job storage j = jobs[jobId]; if (j.status != JobStatus.SUBMITTED || msg.sender != j.evaluator || block.timestamp >= j.expiry) revert InvalidJob();
        uint256 delta = j.budget - j.settledAmount; j.settledAmount = j.budget; j.status = JobStatus.COMPLETED;
        emit JobCompleted(jobId, reason); _release(j, jobId, delta, this.complete.selector);
    }
    function reject(uint256 jobId, bytes32 reason, bytes calldata) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status == JobStatus.OPEN) { if (msg.sender != j.client) revert Unauthorized(); }
        else if (j.status == JobStatus.FUNDED || j.status == JobStatus.SUBMITTED) { if (msg.sender != j.evaluator) revert Unauthorized(); }
        else revert InvalidState();
        JobStatus previous = j.status; j.status = JobStatus.REJECTED; emit JobRejected(jobId, reason);
        if ((previous == JobStatus.FUNDED || previous == JobStatus.SUBMITTED) && j.budget > j.settledAmount) j.token.safeTransfer(j.client, j.budget - j.settledAmount);
    }
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage j = jobs[jobId]; if ((j.status != JobStatus.FUNDED && j.status != JobStatus.SUBMITTED) || block.timestamp < j.expiry) revert InvalidJob();
        j.status = JobStatus.EXPIRED; if (j.budget > j.settledAmount) j.token.safeTransfer(j.client, j.budget - j.settledAmount); emit JobExpired(jobId);
    }
    function _release(Job storage j, uint256 jobId, uint256 amount, bytes4 action) private {
        address receiver = j.payoutReceiver == address(0) ? j.provider : j.payoutReceiver;
        j.token.safeTransfer(receiver, amount); emit ProviderPayout(jobId, receiver, amount);
        if (receiver.code.length != 0) IDisburser(receiver).onDisbursement(jobId, action, address(j.token), amount);
    }
    function getJob(uint256 jobId) external view returns(address,address,address,address,address,uint128,uint128,uint64,JobStatus) {
        Job memory j = jobs[jobId]; return (j.client,j.provider,j.evaluator,j.payoutReceiver,address(j.token),j.budget,j.settledAmount,j.expiry,j.status);
    }
}
