// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {IERC20} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IDisburser} from "./interfaces/IDisburser.sol";
interface IFinancingPayout { function receivePayout(uint256,uint256) external; }
contract ReceivableRouter is IDisburser {
    using SafeTransfer for IERC20;
    error Unauthorized(); error InvalidPayout();
    address public immutable escrow; IERC20 public immutable asset; address public immutable owner; IFinancingPayout public financing; mapping(uint256=>uint256) public routed;
    constructor(address e,IERC20 a,address initialOwner){if(e==address(0)||address(a)==address(0)||initialOwner==address(0))revert Unauthorized();escrow=e;asset=a;owner=initialOwner;}
    function setFinancing(IFinancingPayout f) external {if(msg.sender!=owner||address(financing)!=address(0))revert Unauthorized();financing=f;}
    function onDisbursement(uint256 id,bytes4,address token,uint256 amount) external {if(msg.sender!=escrow||token!=address(asset)||amount==0||address(financing)==address(0))revert InvalidPayout();routed[id]+=amount;asset.safeTransfer(address(financing),amount);financing.receivePayout(id,amount);}
}
