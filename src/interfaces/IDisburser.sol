// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IDisburser {
    function onDisbursement(uint256 jobId, bytes4 action, address token, uint256 amount) external;
}
