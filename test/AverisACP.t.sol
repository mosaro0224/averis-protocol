// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {AverisACP} from "../src/AverisACP.sol";
import {AverisVault} from "../src/AverisVault.sol";
import {AverisFinancing,IAverisVault} from "../src/AverisFinancing.sol";
import {ReceivableRouter,IFinancingPayout} from "../src/ReceivableRouter.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

interface Vm { function prank(address) external; function warp(uint256) external; function expectRevert() external; }
contract AverisACPTest {
    Vm constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));MockUSDC usdc;AverisACP acp;AverisVault vault;AverisFinancing financing;ReceivableRouter router;
    address client=address(0xC1E17);address agent=address(0xA6E17);address evaluator=address(0xEAA1);address lp=address(0x1A1);
    uint128 constant U=1e6;
    function setUp() public {usdc=new MockUSDC();acp=new AverisACP();vault=new AverisVault(usdc,address(this));router=new ReceivableRouter(address(acp),usdc,address(this));financing=new AverisFinancing(usdc,IAverisVault(address(vault)),acp,address(router),address(this),2_000,200,50*U);vault.setFinancing(address(financing));router.setFinancing(IFinancingPayout(address(financing)));usdc.mint(client,1000*U);usdc.mint(lp,1000*U);vm.prank(lp);usdc.approve(address(vault),type(uint256).max);vm.prank(lp);vault.deposit(100*U,lp);}
    function testAtomicCompletionRepaysThenPaysRemainder() public {_fund(1,100*U);vm.prank(agent);financing.draw(1,5*U);vm.prank(agent);acp.submit(1,bytes32("work"),"");vm.prank(evaluator);acp.complete(1,bytes32("ok"),"");(,,,,,,AverisFinancing.Status s)=financing.positions(1);_eq(uint256(s),uint256(AverisFinancing.Status.REPAID));_eq(usdc.balanceOf(agent),99_900_000);_eq(vault.totalAssets(),100_100_000);}
    function testNoFinanceWithoutImmutableRouter() public {vm.prank(client);acp.createJob(agent,evaluator,uint64(block.timestamp+1 days),"x",address(0));vm.prank(agent);acp.setBudget(1,address(usdc),100*U,"");vm.prank(client);usdc.approve(address(acp),100*U);vm.prank(client);acp.fund(1,address(usdc),100*U,"");vm.prank(agent);vm.expectRevert();financing.draw(1,U);}
    function testDoubleFinancingReverts() public {_fund(1,100*U);vm.prank(agent);financing.draw(1,U);vm.prank(agent);vm.expectRevert();financing.draw(1,U);}
    function testRejectWritesOffPrincipal() public {_fund(1,100*U);vm.prank(agent);financing.draw(1,5*U);vm.prank(evaluator);acp.reject(1,bytes32("no"),"");financing.finalizeDefault(1);_eq(vault.outstandingPrincipal(),0);_eq(vault.totalAssets(),95*U);}
    function testExpiryRefundAndDefault() public {_fund(1,100*U);vm.prank(agent);financing.draw(1,5*U);vm.warp(block.timestamp+2 days);acp.claimRefund(1);financing.finalizeDefault(1);_eq(vault.totalAssets(),95*U);}
    function testPartialPayoutRepaysPrincipalFirst() public {_fund(1,100*U);vm.prank(agent);financing.draw(1,5*U);vm.prank(agent);acp.submit(1,bytes32("work"),"");vm.prank(evaluator);acp.settleClaim(1,3*U,bytes32("partial"));(,,,uint128 repaid,,,) = financing.positions(1);_eq(repaid,3*U);}
    function testReceiverCannotChangeAfterFunding() public {_fund(1,100*U);vm.prank(agent);vm.expectRevert();acp.setPayoutReceiver(1,agent);}
    function testSettlementFailsAtExpiry() public {_fund(1,100*U);vm.prank(agent);acp.submit(1,bytes32("work"),"");vm.warp(block.timestamp+1 days);vm.prank(evaluator);vm.expectRevert();acp.complete(1,bytes32("late"),"");}
    function testSolvencyCapIncludesRoundedFee() public {_fund(1,100*U);financing.setParameters(10_000,200,200*U);uint256 cap=financing.maxAdvance(1);_eq(cap,98_039_215);uint256 fee=(cap*200+9_999)/10_000;require(cap+fee<=100*U,"insolvent");vm.prank(agent);vm.expectRevert();financing.draw(1,uint128(cap+1));}
    function _fund(uint256 id,uint128 amount) internal {vm.prank(client);acp.createJob(agent,evaluator,uint64(block.timestamp+1 days),"job",address(0));vm.prank(agent);acp.setPayoutReceiver(id,address(router));vm.prank(agent);acp.setBudget(id,address(usdc),amount,"");vm.prank(client);usdc.approve(address(acp),amount);vm.prank(client);acp.fund(id,address(usdc),amount,"");}
    function _eq(uint256 a,uint256 b) internal pure {require(a==b,"assert");}
}
