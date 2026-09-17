// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "../interfaces/IERC20.sol";
import {IReceivableAdapter} from "../interfaces/IReceivableAdapter.sol";

interface IRouter { function receiveSettlement(uint256 jobId, address asset, uint256 amount) external; }

/// @dev Test-only escrow model. Its payout receiver is fixed at funding, the
/// property a production ERC-8183 adapter must establish before financing.
contract MockReceivableEscrow is IReceivableAdapter {
    struct Stored { address provider; address receiver; uint128 receivable; uint64 expiry; JobState state; }
    IERC20 public immutable asset; mapping(uint256 => Stored) public jobs;
    constructor(IERC20 asset_) { asset = asset_; }
    function createFunded(uint256 id, address provider, address receiver, uint128 amount, uint64 expiry) external {
        jobs[id] = Stored(provider, receiver, amount, expiry, JobState.FUNDED); asset.transferFrom(msg.sender, address(this), amount);
    }
    function job(uint256 id) external view returns(address,address,uint256,uint64,JobState) { Stored memory j=jobs[id]; return(j.provider,j.receiver,j.receivable,j.expiry,j.state); }
    function settle(uint256 id, uint128 amount) external { Stored storage j=jobs[id]; require(j.state==JobState.FUNDED && amount<=j.receivable,"invalid"); j.state=JobState.SETTLED; asset.transfer(j.receiver, amount); IRouter(j.receiver).receiveSettlement(id,address(asset),amount); }
    function reject(uint256 id) external { jobs[id].state=JobState.REJECTED; }
}
