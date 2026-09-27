// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/passport/AgentPolicyRegistry.sol";
import "../src/passport/AgentReceiptRegistry.sol";

/**
 * @notice Deploy AgentPolicyRegistry and AgentReceiptRegistry to Arc Testnet.
 *
 * Usage:
 *   forge script script/DeployPassportArc.s.sol \
 *     --rpc-url https://rpc.testnet.arc.io \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast \
 *     --chain-id 5042002
 */
contract DeployPassportArc is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("Deployer:   ", deployer);
        console.log("Chain ID:   ", block.chainid);

        vm.startBroadcast(deployerKey);

        AgentPolicyRegistry  policyReg  = new AgentPolicyRegistry();
        AgentReceiptRegistry receiptReg = new AgentReceiptRegistry();

        vm.stopBroadcast();

        console.log("AgentPolicyRegistry (Arc): ", address(policyReg));
        console.log("AgentReceiptRegistry (Arc):", address(receiptReg));
    }
}
