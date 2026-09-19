// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IJobAdapter} from "../interfaces/IJobAdapter.sol";

/// @notice Generic escrow adapter for protocols that do not implement ERC-8183
/// but expose a minimal provider/balance/expiry interface. Tier = VERIFIED.
/// The owner configures per-escrow capability flags (supportsSetReceiver).
interface IGenericEscrow {
    function provider(uint256 jobId)      external view returns (address);
    function escrowBalance(uint256 jobId) external view returns (uint256);
    function escrowToken(uint256 jobId)   external view returns (address);
    function jobExpiry(uint256 jobId)     external view returns (uint64);
    function isJobActive(uint256 jobId)   external view returns (bool);
    // Optional — only on escrows that support receiver mutation
    function setPayoutReceiver(uint256 jobId, address receiver) external;
    function payoutReceiver(uint256 jobId) external view returns (address);
    function client(uint256 jobId)        external view returns (address);
}

contract GenericEscrowAdapter is IJobAdapter {
    error Unauthorized();
    error InvalidJob();

    address public immutable owner;
    address public immutable router;
    address public immutable usdc;

    struct EscrowConfig {
        bool registered;
        bool supportsSetReceiver;
        bool supportsClient;
        bool supportsPayoutReceiverRead;
    }
    mapping(address => EscrowConfig) public escrowConfig;

    event EscrowConfigured(address indexed escrow, bool supportsSetReceiver);

    constructor(address owner_, address router_, address usdc_) {
        require(owner_ != address(0) && router_ != address(0) && usdc_ != address(0), "zero addr");
        owner  = owner_;
        router = router_;
        usdc   = usdc_;
    }

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }

    function configureEscrow(
        address escrow_,
        bool    supportsSetReceiver_,
        bool    supportsClient_,
        bool    supportsPayoutReceiverRead_
    ) external onlyOwner {
        escrowConfig[escrow_] = EscrowConfig(true, supportsSetReceiver_, supportsClient_, supportsPayoutReceiverRead_);
        emit EscrowConfigured(escrow_, supportsSetReceiver_);
    }

    function tier() external pure override returns (AdapterTier) {
        return AdapterTier.VERIFIED;
    }

    function getJob(uint256 jobId) external view override returns (JobView memory v) {
        // This adapter requires a specific escrow to be passed as the protocol.
        // It cannot be called without context — the caller identifies the escrow
        // via the registry (protocol, adapterId) pair; we read it from storage.
        // For the generic adapter, jobId encodes escrow address in upper 160 bits
        // and actual jobId in lower 96 bits.
        address escrowAddr = address(uint160(jobId >> 96));
        uint256 realJobId  = jobId & type(uint96).max;

        EscrowConfig memory cfg = escrowConfig[escrowAddr];
        if (!cfg.registered) revert InvalidJob();

        IGenericEscrow esc = IGenericEscrow(escrowAddr);

        address provider_ = esc.provider(realJobId);
        if (provider_ == address(0)) revert InvalidJob();

        uint256 balance = esc.escrowBalance(realJobId);
        address token_  = esc.escrowToken(realJobId);
        uint64  expiry_ = esc.jobExpiry(realJobId);
        bool    active  = esc.isJobActive(realJobId);

        if (token_ != usdc)             revert InvalidJob();
        if (balance == 0)               revert InvalidJob();
        if (expiry_ <= block.timestamp) revert InvalidJob();
        if (!active)                    revert InvalidJob();

        v.protocol  = escrowAddr;
        v.jobId     = jobId;
        v.agent     = provider_;
        v.token     = token_;
        v.budget    = uint128(balance > type(uint128).max ? type(uint128).max : balance);
        v.expiry    = expiry_;
        v.tier      = AdapterTier.VERIFIED;
        v.state     = JobState.FUNDED;  // isJobActive implies funded

        if (cfg.supportsClient) {
            try esc.client(realJobId) returns (address c) { v.client = c; } catch {}
        }
        if (cfg.supportsPayoutReceiverRead) {
            try esc.payoutReceiver(realJobId) returns (address r) {
                v.payoutReceiver = r;
                v.repayMode = (r == router) ? RepayMode.LIEN : RepayMode.OBLIGATION;
            } catch {
                v.repayMode = RepayMode.OBLIGATION;
            }
        } else {
            v.repayMode = cfg.supportsSetReceiver ? RepayMode.LIEN : RepayMode.OBLIGATION;
        }
    }

    function setLien(uint256 jobId, address router_) external override returns (bool) {
        address escrowAddr = address(uint160(jobId >> 96));
        uint256 realJobId  = jobId & type(uint96).max;
        EscrowConfig memory cfg = escrowConfig[escrowAddr];
        if (!cfg.registered || !cfg.supportsSetReceiver) return false;
        try IGenericEscrow(escrowAddr).setPayoutReceiver(realJobId, router_) {
            return true;
        } catch {
            return false;
        }
    }
}
