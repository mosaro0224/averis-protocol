// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/passport/AgentPolicyRegistry.sol";
import "../src/passport/AgentReceiptRegistry.sol";

/**
 * @notice Deploy AgentPolicyRegistry and AgentReceiptRegistry to Robinhood Chain Testnet.
 *
 * Usage:
 *   forge script script/DeployPassport.s.sol \
 *     --rpc-url https://rpc.testnet.chain.robinhood.com \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast \
 *     --chain-id 46630
 *
 * To also deploy to Arc Testnet, use DeployPassportArc.s.sol
 */
contract DeployPassport is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("Deployer:   ", deployer);
        console.log("Chain ID:   ", block.chainid);
        console.log("Balance:    ", deployer.balance);

        vm.startBroadcast(deployerKey);

        AgentPolicyRegistry  policyReg  = new AgentPolicyRegistry();
        AgentReceiptRegistry receiptReg = new AgentReceiptRegistry();

        vm.stopBroadcast();

        console.log("AgentPolicyRegistry: ", address(policyReg));
        console.log("AgentReceiptRegistry:", address(receiptReg));
        console.log("");
        console.log("Add to Railway env:");
        console.log("PASSPORT_POLICY_REGISTRY=",  address(policyReg));
        console.log("PASSPORT_RECEIPT_REGISTRY=", address(receiptReg));
        console.log("PASSPORT_CHAIN_ID=46630");
    }
}
