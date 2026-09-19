// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./interfaces/IERC20.sol";
import {AverisJobPool} from "./AverisJobPool.sol";

/// @notice CREATE2 factory for AverisJobPool contracts.
/// Only AverisFinancing can create pools; the owner wires the financing address once.
contract AverisPoolFactory {
    error Unauthorized();

    address public immutable owner;
    address public financing;

    event PoolCreated(uint256 indexed jobId, address indexed agent, address pool, uint128 amount);

    constructor(address owner_) {
        require(owner_ != address(0), "zero owner");
        owner = owner_;
    }

    /// @notice Called once by owner after AverisFinancing is deployed.
    function setFinancing(address financing_) external {
        if (msg.sender != owner || financing != address(0)) revert Unauthorized();
        financing = financing_;
    }

    /// @notice Deploy a new AverisJobPool via CREATE2.
    /// Salt is keccak256(jobId) — one pool per jobId, no collision possible
    /// because AverisFinancing enforces one position per jobId.
    function createPool(
        IERC20          asset,
        address         agent,
        uint256         jobId,
        uint128         amount,
        uint64          expiry,
        address[] calldata recipients,
        uint128         perTxLimit,
        address         hood
    ) external returns (address pool) {
        if (msg.sender != financing) revert Unauthorized();

        bytes32 salt = keccak256(abi.encode(jobId));
        pool = address(new AverisJobPool{salt: salt}(
            asset,
            agent,
            jobId,
            financing,
            hood,
            amount,
            expiry,
            recipients,
            perTxLimit
        ));
        emit PoolCreated(jobId, agent, pool, amount);
    }

    /// @notice Pre-compute the pool address for a given jobId (before deployment).
    function predictPool(
        IERC20          asset,
        address         agent,
        uint256         jobId,
        uint128         amount,
        uint64          expiry,
        address[] calldata recipients,
        uint128         perTxLimit,
        address         hood
    ) external view returns (address) {
        bytes32 salt = keccak256(abi.encode(jobId));
        bytes memory creationCode = abi.encodePacked(
            type(AverisJobPool).creationCode,
            abi.encode(asset, agent, jobId, financing, hood, amount, expiry, recipients, perTxLimit)
        );
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(creationCode)));
        return address(uint160(uint256(h)));
    }
}
