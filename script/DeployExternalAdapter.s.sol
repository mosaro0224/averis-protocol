// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ExternalJobAdapter}    from "../src/ExternalJobAdapter.sol";
import {AverisAdapterRegistry} from "../src/AverisAdapterRegistry.sol";
import {IJobAdapter}           from "../src/interfaces/IJobAdapter.sol";

/// @notice Deploys ExternalJobAdapter for a given external platform and
/// registers it in AverisAdapterRegistry as an ATTESTED-tier adapter.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY   — deployer / owner wallet
///   AVERIS_REGISTRY        — AverisAdapterRegistry address
///   AVERIS_USDC            — USDC address on this chain
///   EXTERNAL_PLATFORM      — external job contract to whitelist
///   ADAPTER_NAME           — human-readable name for the registry entry
///
/// Optional:
///   ADAPTER_ID             — adapterId in the registry (default 0)
contract DeployExternalAdapter is Script {
    function run() external {
        uint256 pk          = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address registry    = vm.envAddress("AVERIS_REGISTRY");
        address usdc        = vm.envAddress("AVERIS_USDC");
        address extPlatform = vm.envAddress("EXTERNAL_PLATFORM");
        string  memory name = vm.envString("ADAPTER_NAME");
        uint256 adapterId   = vm.envOr("ADAPTER_ID", uint256(0));

        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);
        console.log("Registry:", registry);
        console.log("Platform:", extPlatform);

        vm.startBroadcast(pk);

        ExternalJobAdapter adapter = new ExternalJobAdapter(
            deployer,   // owner
            usdc,       // USDC address
            extPlatform // external platform
        );
        console.log("ExternalJobAdapter deployed at:", address(adapter));

        // Register with ATTESTED tier in the registry
        AverisAdapterRegistry(registry).registerAdapter(
            extPlatform,
            adapterId,
            address(adapter),
            IJobAdapter.AdapterTier.ATTESTED,
            name
        );
        console.log("Registered adapter:", name, "adapterId:", adapterId);

        vm.stopBroadcast();
    }
}
