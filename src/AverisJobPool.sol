// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";

/// @notice Per-position controlled spending pool.
/// Holds approved USDC and enforces spending policies on-chain.
/// One pool is deployed per financing position by AverisPoolFactory.
///
/// Security invariants enforced here (not in financing):
///   1. Only the agent can call spend().
///   2. Frozen pools cannot spend — freeze is irreversible.
///   3. Expired pools cannot spend.
///   4. Recipient must be on the allowedRecipients list.
///   5. Amount per call cannot exceed perTxLimit.
///   6. Cumulative spend cannot exceed approvedAmount.
///   7. nonReentrant on spend() prevents re-entry via token callbacks.
///   8. No receive()/fallback() — pool cannot accept ETH or unexpected USDC.
contract AverisJobPool {
    using SafeTransfer for IERC20;

    error Unauthorized();
    error Frozen();
    error Expired();
    error DisallowedRecipient();
    error ExceedsPerTxLimit();
    error ExceedsApprovedAmount();
    error Reentrancy();
    error ZeroAmount();

    IERC20  public immutable asset;
    address public immutable agent;
    uint256 public immutable jobId;
    address public immutable financing; // only caller of freeze() / returnUnspent()
    address public immutable hood;      // also authorised to call freeze()
    uint128 public immutable approvedAmount;
    uint64  public immutable expiry;

    address[] public allowedRecipients;
    uint128   public perTxLimit;
    uint128   public totalSpent;
    bool      public frozen;

    uint256 private _unlocked = 1;

    event Spent(uint256 indexed jobId, address indexed recipient, uint128 amount, bytes32 purpose);
    event PoolFrozen(uint256 indexed jobId);
    event RecipientAdded(uint256 indexed jobId, address recipient);
    event UnspentReturned(uint256 indexed jobId, uint256 amount);

    constructor(
        IERC20          asset_,
        address         agent_,
        uint256         jobId_,
        address         financing_,
        address         hood_,
        uint128         approvedAmount_,
        uint64          expiry_,
        address[] memory recipients_,
        uint128         perTxLimit_
    ) {
        require(agent_ != address(0) && financing_ != address(0) && hood_ != address(0), "zero addr");
        asset          = asset_;
        agent          = agent_;
        jobId          = jobId_;
        financing      = financing_;
        hood           = hood_;
        approvedAmount = approvedAmount_;
        expiry         = expiry_;
        perTxLimit     = perTxLimit_;
        for (uint256 i = 0; i < recipients_.length; i++) {
            allowedRecipients.push(recipients_[i]);
        }
    }

    modifier nonReentrant() {
        if (_unlocked != 1) revert Reentrancy();
        _unlocked = 2;
        _;
        _unlocked = 1;
    }

    // ── Spending ─────────────────────────────────────────────────────────────

    /// @notice Transfer approved USDC to a pre-approved recipient.
    /// All policy checks happen before any state change (CEI).
    function spend(address recipient, uint128 amount, bytes32 purpose)
        external
        nonReentrant
    {
        if (msg.sender != agent)          revert Unauthorized();
        if (frozen)                        revert Frozen();
        if (block.timestamp >= expiry)     revert Expired();
        if (!_isAllowed(recipient))        revert DisallowedRecipient();
        if (amount == 0)                   revert ZeroAmount();
        if (amount > perTxLimit)           revert ExceedsPerTxLimit();
        if (uint256(totalSpent) + amount > uint256(approvedAmount)) revert ExceedsApprovedAmount();

        totalSpent += amount;                        // state before external call (CEI)
        asset.safeTransfer(recipient, amount);
        emit Spent(jobId, recipient, amount, purpose);
    }

    // ── Admin (financing / hood only) ─────────────────────────────────────────

    /// @notice Freeze the pool — no further spending permitted.
    /// Called by AverisFinancing on default/expiry, or by AverisHood on anomaly.
    function freeze() external {
        if (msg.sender != financing && msg.sender != hood) revert Unauthorized();
        frozen = true;
        emit PoolFrozen(jobId);
    }

    /// @notice Return all remaining USDC to the vault.
    /// Called exclusively by AverisFinancing during _closeLoss().
    function returnUnspent(address vault) external {
        if (msg.sender != financing) revert Unauthorized();
        uint256 balance = asset.balanceOf(address(this));
        if (balance > 0) {
            asset.safeTransfer(vault, balance);
            emit UnspentReturned(jobId, balance);
        }
    }

    /// @notice Add an approved recipient after pool creation.
    /// Called by AverisFinancing (e.g. agent-requested recipient whitelist extension).
    function addAllowedRecipient(address recipient) external {
        if (msg.sender != financing) revert Unauthorized();
        allowedRecipients.push(recipient);
        emit RecipientAdded(jobId, recipient);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function remainingBalance() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function allowedRecipientsLength() external view returns (uint256) {
        return allowedRecipients.length;
    }

    function isAllowedRecipient(address addr) external view returns (bool) {
        return _isAllowed(addr);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _isAllowed(address addr) private view returns (bool) {
        for (uint256 i = 0; i < allowedRecipients.length; i++) {
            if (allowedRecipients[i] == addr) return true;
        }
        return false;
    }
}
