// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}       from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";

/// @notice Averis Protocol Reserve Fund.
///
/// Accumulates the reserve portion (10% of fees) as a first-loss buffer.
/// Only the owner can authorise drawdowns (e.g. to top up the vault after a default).
/// Balance is permanently visible on-chain.
///
/// Design constraints:
///   • Accepts only USDC (or any configured ERC-20) via receiveReserveFee().
///   • Cannot be drained by any party other than the owner.
///   • Every drawdown emits an event for off-chain monitoring.
///   • Owner can be replaced via transferOwnership() — use this to hand control
///     to a Gnosis Safe multisig before mainnet.
contract AverisReserve {
    using SafeTransfer for IERC20;

    error Unauthorized();
    error ZeroAmount();
    error InsufficientBalance();

    IERC20  public immutable asset;
    address public           owner;

    event FundsReceived(address indexed from, uint256 amount);
    event FundsDrawn(address indexed to, uint256 amount, string reason);
    event OwnershipTransferred(address indexed previous, address indexed next);

    constructor(IERC20 asset_, address owner_) {
        require(owner_ != address(0), "zero owner");
        asset = asset_;
        owner = owner_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @notice Current USDC balance held in this reserve.
    function balance() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Called by AverisFinancingV2 to deposit the reserve portion of a fee.
    ///         Caller must have approved this contract to spend `amount` of asset.
    function receiveReserveFee(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit FundsReceived(msg.sender, amount);
    }

    /// @notice Owner draws from the reserve, e.g. to partially cover a vault default.
    /// @param to     Destination address (typically the vault).
    /// @param amount Amount of USDC to transfer out.
    /// @param reason Free-text reason — recorded permanently on-chain.
    function draw(address to, uint256 amount, string calldata reason) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (asset.balanceOf(address(this)) < amount) revert InsufficientBalance();
        asset.safeTransfer(to, amount);
        emit FundsDrawn(to, amount, reason);
    }

    /// @notice Transfer ownership to a new address (e.g. a Gnosis Safe multisig).
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert Unauthorized();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
