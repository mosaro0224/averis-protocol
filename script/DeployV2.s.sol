// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20}                from "../src/interfaces/IERC20.sol";
import {AverisVault}           from "../src/AverisVault.sol";
import {AverisACP}             from "../src/AverisACP.sol";
import {ReceivableRouter, IFinancingPayout} from "../src/ReceivableRouter.sol";
import {AverisCredit}          from "../src/AverisCredit.sol";
import {AverisAdapterRegistry} from "../src/AverisAdapterRegistry.sol";
import {AverisPoolFactory}     from "../src/AverisPoolFactory.sol";
import {AverisHood}            from "../src/AverisHood.sol";
import {AverisFinancingV2, IAverisVaultV2} from "../src/AverisFinancingV2.sol";
import {AverisACPAdapter, IAverisACPFull}  from "../src/adapters/AverisACPAdapter.sol";
import {AverisReserve}         from "../src/AverisReserve.sol";
import {IJobAdapter}           from "../src/interfaces/IJobAdapter.sol";

interface Vm {
    function envAddress(string calldata) external returns (address);
    function envUint(string calldata) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployV2 {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (
        AverisVault         vault,
        AverisACP           escrow,
        ReceivableRouter    router,
        AverisCredit        creditEngine,
        AverisAdapterRegistry adapterRegistry,
        AverisPoolFactory   poolFactory,
        AverisHood          hood,
        AverisFinancingV2   financing,
        AverisACPAdapter    acpAdapter
    ) {
        IERC20  usdc          = IERC20(vm.envAddress("ARC_USDC"));
        address protocolOwner = vm.envAddress("PROTOCOL_OWNER"); // 0x4bAf1e5E3355f37539f423Ba251Dd7f98fE2Ea56
        uint256 expectedChain = vm.envUint("ARC_CHAIN_ID");

        require(
            address(usdc) != address(0) &&
            protocolOwner != address(0) &&
            expectedChain == block.chainid,
            "invalid deployment config"
        );

        // Read Hood parameters
        uint128 maxPerAgent       = uint128(vm.envUint("HOOD_MAX_PER_AGENT_USDC"));
        uint128 maxTotal          = uint128(vm.envUint("HOOD_MAX_TOTAL_USDC"));
        uint128 tierCapNative     = uint128(vm.envUint("HOOD_TIER_CAP_NATIVE_USDC"));
        uint128 tierCapVerified   = uint128(vm.envUint("HOOD_TIER_CAP_VERIFIED_USDC"));
        uint128 tierCapAttested   = uint128(vm.envUint("HOOD_TIER_CAP_ATTESTED_USDC"));
        uint8   maxJobs           = uint8(vm.envUint("HOOD_MAX_JOBS_PER_AGENT"));
        uint16  maxConcentration  = uint16(vm.envUint("HOOD_MAX_CONCENTRATION_BPS"));
        uint16  advanceRateBps    = uint16(vm.envUint("ADVANCE_RATE_BPS"));
        uint16  feeBps            = uint16(vm.envUint("FEE_BPS"));
        uint128 protocolMax       = uint128(vm.envUint("PROTOCOL_MAX_USDC"));
        uint128 perTxLimit        = uint128(vm.envUint("PER_TX_LIMIT_USDC"));
        address treasury          = vm.envAddress("TREASURY_ADDRESS");
        // Fee split: 70% LP / 20% treasury / 10% reserve (hardcoded Option B)
        AverisFinancingV2.FeeSplit memory split = AverisFinancingV2.FeeSplit(7_000, 2_000, 1_000);

        vm.startBroadcast();

        // 1. Core V1-unchanged contracts
        vault   = new AverisVault(usdc, protocolOwner);
        escrow  = new AverisACP();
        router  = new ReceivableRouter(address(escrow), usdc, protocolOwner);
        AverisReserve reserveFund = new AverisReserve(usdc, protocolOwner);

        // 2. V2 infrastructure
        creditEngine     = new AverisCredit();
        adapterRegistry  = new AverisAdapterRegistry(protocolOwner);
        poolFactory      = new AverisPoolFactory(protocolOwner);

        // 3. Hood
        hood = new AverisHood(
            protocolOwner,
            maxPerAgent,
            maxTotal,
            tierCapNative,
            tierCapVerified,
            tierCapAttested,
            maxJobs,
            maxConcentration
        );

        // 4. Financing V2
        financing = new AverisFinancingV2(
            usdc,
            IAverisVaultV2(address(vault)),
            adapterRegistry,
            creditEngine,
            address(router),
            poolFactory,
            hood,
            protocolOwner,
            advanceRateBps,
            feeBps,
            protocolMax,
            perTxLimit,
            treasury,
            reserveFund,
            split
        );

        // 5. Wire one-time setters
        vault.setFinancing(address(financing));
        router.setFinancing(IFinancingPayout(address(financing)));
        poolFactory.setFinancing(address(financing));
        hood.setFinancing(address(financing));

        // 6. Native ACP adapter + register
        acpAdapter = new AverisACPAdapter(IAverisACPFull(address(escrow)), address(router));
        adapterRegistry.registerAdapter(
            address(escrow),
            0,
            address(acpAdapter),
            IJobAdapter.AdapterTier.NATIVE,
            "AverisACP Native"
        );

        vm.stopBroadcast();
    }
}
