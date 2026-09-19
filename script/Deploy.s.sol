// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "../src/interfaces/IERC20.sol";
import {AverisVault} from "../src/AverisVault.sol";
import {AverisFinancing, IAverisVault} from "../src/AverisFinancing.sol";
import {AverisACP} from "../src/AverisACP.sol";
import {ReceivableRouter, IFinancingPayout} from "../src/ReceivableRouter.sol";

interface Vm { function envAddress(string calldata) external returns(address); function envUint(string calldata) external returns(uint256); function startBroadcast() external; function stopBroadcast() external; }
contract Deploy {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function run() external returns (AverisVault vault, AverisACP escrow, AverisFinancing financing, ReceivableRouter router) {
        IERC20 usdc = IERC20(vm.envAddress("ARC_USDC")); address protocolOwner=vm.envAddress("PROTOCOL_OWNER"); uint256 expectedChain=vm.envUint("ARC_CHAIN_ID");
        require(address(usdc)!=address(0)&&protocolOwner!=address(0)&&expectedChain==block.chainid,"invalid deployment config");
        vm.startBroadcast(); vault = new AverisVault(usdc,protocolOwner); escrow = new AverisACP(); router = new ReceivableRouter(address(escrow), usdc,protocolOwner);
        financing = new AverisFinancing(usdc, IAverisVault(address(vault)), escrow, address(router),protocolOwner, 2_000, 200, uint128(vm.envUint("PROTOCOL_MAX_USDC")));
        vault.setFinancing(address(financing)); router.setFinancing(IFinancingPayout(address(financing))); vm.stopBroadcast();
    }
}
