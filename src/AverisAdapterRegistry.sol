// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IJobAdapter} from "./interfaces/IJobAdapter.sol";

/// @notice Owner-managed whitelist of approved job adapters.
/// AverisFinancing.draw() reads this to resolve the adapter for a given
/// (protocol address, adapterId) pair and confirm it is active.
/// The registry — NOT the adapter's own tier() — is the authoritative tier source.
contract AverisAdapterRegistry {
    error Unauthorized();
    error AlreadyRegistered();
    error NotRegistered();
    error ZeroAddress();

    struct AdapterConfig {
        address           adapter;
        IJobAdapter.AdapterTier tier;
        bool              active;
        string            name;
    }

    address public immutable owner;

    // key = keccak256(abi.encode(protocolAddress, adapterId))
    // adapterId = 0 for single-adapter protocols; non-zero for multi-adapter
    mapping(bytes32 => AdapterConfig) private _configs;

    // Reverse lookup: adapter address → registry key (for deactivation by address)
    mapping(address => bytes32) private _adapterKey;

    event AdapterRegistered(bytes32 indexed key, address indexed adapter, IJobAdapter.AdapterTier tier, string name);
    event AdapterDeactivated(bytes32 indexed key, address indexed adapter);
    event AdapterReactivated(bytes32 indexed key, address indexed adapter);

    constructor(address owner_) {
        require(owner_ != address(0), "zero owner");
        owner = owner_;
    }

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }

    // ── Registration ──────────────────────────────────────────────────────────

    /// @notice Register an adapter for a (protocol, adapterId) pair.
    /// The tier stored here overrides the adapter's own tier() return value.
    function registerAdapter(
        address         protocol,
        uint256         adapterId,
        address         adapter,
        IJobAdapter.AdapterTier tier,
        string calldata name_
    ) external onlyOwner {
        if (adapter == address(0) || protocol == address(0)) revert ZeroAddress();
        bytes32 key = _key(protocol, adapterId);
        if (_configs[key].adapter != address(0)) revert AlreadyRegistered();
        _configs[key] = AdapterConfig(adapter, tier, true, name_);
        _adapterKey[adapter] = key;
        emit AdapterRegistered(key, adapter, tier, name_);
    }

    function deactivateAdapter(address adapter) external onlyOwner {
        bytes32 key = _adapterKey[adapter];
        if (_configs[key].adapter == address(0)) revert NotRegistered();
        _configs[key].active = false;
        emit AdapterDeactivated(key, adapter);
    }

    function reactivateAdapter(address adapter) external onlyOwner {
        bytes32 key = _adapterKey[adapter];
        if (_configs[key].adapter == address(0)) revert NotRegistered();
        _configs[key].active = true;
        emit AdapterReactivated(key, adapter);
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /// @notice Returns the config for a (protocol, adapterId) pair.
    /// Reverts if not registered. Caller should also check .active.
    function getAdapter(address protocol, uint256 adapterId)
        external view
        returns (AdapterConfig memory)
    {
        bytes32 key = _key(protocol, adapterId);
        AdapterConfig memory c = _configs[key];
        if (c.adapter == address(0)) revert NotRegistered();
        return c;
    }

    /// @notice Returns whether a given (protocol, adapterId) pair is registered and active.
    function isActive(address protocol, uint256 adapterId) external view returns (bool) {
        AdapterConfig memory c = _configs[_key(protocol, adapterId)];
        return c.adapter != address(0) && c.active;
    }

    function _key(address protocol, uint256 adapterId) internal pure returns (bytes32) {
        return keccak256(abi.encode(protocol, adapterId));
    }
}
