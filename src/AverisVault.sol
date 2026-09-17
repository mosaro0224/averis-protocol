// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";

/// @notice Minimal USDC share vault. Outstanding principal is included in NAV;
/// unearned fees are deliberately excluded until they are actually recovered.
contract AverisVault {
    using SafeTransfer for IERC20;
    error Unauthorized(); error ZeroAmount(); error InsufficientLiquidity(); error Reentrancy();
    IERC20 public immutable asset;
    address public financing;
    string public constant name = "Averis USDC Vault";
    string public constant symbol = "avUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    uint256 public outstandingPrincipal;
    mapping(address => uint256) public balanceOf;
    uint256 private unlocked = 1;
    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event PrincipalDeployed(uint256 amount); event PrincipalRepaid(uint256 principal, uint256 fee); event PrincipalWrittenOff(uint256 amount);

    address public immutable owner;
    constructor(IERC20 asset_, address initialOwner) { if (initialOwner == address(0)) revert Unauthorized(); asset = asset_; owner = initialOwner; }
    modifier nonReentrant() { if (unlocked != 1) revert Reentrancy(); unlocked = 2; _; unlocked = 1; }
    modifier onlyFinancing() { if (msg.sender != financing) revert Unauthorized(); _; }
    function setFinancing(address financing_) external { if (msg.sender != owner || financing != address(0)) revert Unauthorized(); financing = financing_; }
    function totalAssets() public view returns (uint256) { return asset.balanceOf(address(this)) + outstandingPrincipal; }
    function availableLiquidity() public view returns (uint256) { return asset.balanceOf(address(this)); }
    function convertToShares(uint256 assets) public view returns (uint256) {
        // Virtual assets/shares neutralize first-depositor donation inflation.
        return assets * (totalSupply + 1e6) / (totalAssets() + 1);
    }
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares * (totalAssets() + 1) / (totalSupply + 1e6);
    }
    function deposit(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        shares = convertToShares(assets); if (shares == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), assets); totalSupply += shares; balanceOf[receiver] += shares;
        emit Deposit(msg.sender, receiver, assets, shares);
    }
    function withdraw(uint256 assets, address receiver, address owner_) external nonReentrant returns (uint256 shares) {
        shares = convertToShares(assets); if (assets == 0 || shares == 0) revert ZeroAmount();
        if (msg.sender != owner_) revert Unauthorized(); if (balanceOf[owner_] < shares) revert Unauthorized();
        if (assets > availableLiquidity()) revert InsufficientLiquidity();
        balanceOf[owner_] -= shares; totalSupply -= shares; asset.safeTransfer(receiver, assets); emit Withdraw(owner_, receiver, assets, shares);
    }
    function deploy(address recipient, uint256 amount) external onlyFinancing nonReentrant {
        if (amount > availableLiquidity()) revert InsufficientLiquidity(); outstandingPrincipal += amount; asset.safeTransfer(recipient, amount); emit PrincipalDeployed(amount);
    }
    function receiveRepayment(uint256 principal, uint256 fee) external onlyFinancing nonReentrant {
        outstandingPrincipal -= principal; asset.safeTransferFrom(msg.sender, address(this), principal + fee); emit PrincipalRepaid(principal, fee);
    }
    function writeOff(uint256 principal) external onlyFinancing { outstandingPrincipal -= principal; emit PrincipalWrittenOff(principal); }
}
