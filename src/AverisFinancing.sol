// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {IERC20} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IAverisACP} from "./interfaces/IAverisACP.sol";
interface IAverisVault { function availableLiquidity() external view returns(uint256); function deploy(address,uint256) external; function receiveRepayment(uint256,uint256) external; function writeOff(uint256) external; }

contract AverisFinancing {
    using SafeTransfer for IERC20;
    enum Status { NONE, ACTIVE, REPAID, PARTIALLY_RECOVERED, DEFAULTED, EXPIRED }
    struct Position { address agent; uint128 principal; uint128 fee; uint128 principalRepaid; uint128 feeRepaid; uint64 expiry; Status status; }
    error Unauthorized(); error IneligibleJob(); error ExistingPosition(); error InvalidAmount(); error NotActive();
    IERC20 public immutable asset; IAverisVault public immutable vault; IAverisACP public immutable escrow; address public immutable router; address public immutable owner;
    uint16 public advanceRateBps; uint16 public feeBps; uint128 public protocolMaximum; mapping(address=>uint128) public creditLimit; mapping(uint256=>Position) public positions;
    event Drawn(uint256 indexed jobId,address indexed agent,uint256 principal,uint256 fee); event Repaid(uint256 indexed jobId,uint256 principal,uint256 fee); event Defaulted(uint256 indexed jobId,Status status,uint256 principalLoss);
    constructor(IERC20 a,IAverisVault v,IAverisACP e,address r,address initialOwner,uint16 ar,uint16 f,uint128 m){if(ar>10_000||f>10_000||r==address(0)||initialOwner==address(0))revert InvalidAmount();asset=a;vault=v;escrow=e;router=r;owner=initialOwner;advanceRateBps=ar;feeBps=f;protocolMaximum=m;}
    modifier onlyOwner(){if(msg.sender!=owner)revert Unauthorized();_;} modifier onlyRouter(){if(msg.sender!=router)revert Unauthorized();_;}
    function setParameters(uint16 ar,uint16 f,uint128 m) external onlyOwner {if(ar>10_000||f>10_000)revert InvalidAmount();advanceRateBps=ar;feeBps=f;protocolMaximum=m;}
    function setCreditLimit(address agent,uint128 limit) external onlyOwner {creditLimit[agent]=limit;}
    function maxAdvance(uint256 id) public view returns(uint256) {
        (,address provider,,address receiver,address token,uint128 budget,,uint64 expiry,IAverisACP.JobStatus state)=escrow.getJob(id);
        if(provider==address(0)||receiver!=router||token!=address(asset)||state!=IAverisACP.JobStatus.FUNDED||expiry<=block.timestamp)return 0;
        uint256 advanceCap=uint256(budget)*advanceRateBps/10_000;
        // The ceil fee charged by draw must fit inside this job's receivable.
        uint256 solvencyCap=uint256(budget)*10_000/(10_000+feeBps);
        uint256 cap=advanceCap<solvencyCap?advanceCap:solvencyCap;uint256 agentCap=creditLimit[provider];if(agentCap==0)agentCap=protocolMaximum;cap=cap<agentCap?cap:agentCap;cap=cap<protocolMaximum?cap:protocolMaximum;uint256 liquid=vault.availableLiquidity();return cap<liquid?cap:liquid;
    }
    function draw(uint256 id,uint128 amount) external {
        if(positions[id].status!=Status.NONE)revert ExistingPosition();(,address provider,,address receiver,address token,, ,uint64 expiry,IAverisACP.JobStatus state)=escrow.getJob(id);
        if(msg.sender!=provider||receiver!=router||token!=address(asset)||state!=IAverisACP.JobStatus.FUNDED||expiry<=block.timestamp||amount==0||amount>maxAdvance(id))revert IneligibleJob();
        uint128 fee=uint128((uint256(amount)*feeBps+9_999)/10_000);if(uint256(amount)+fee>_budget(id))revert IneligibleJob();positions[id]=Position(msg.sender,amount,fee,0,0,expiry,Status.ACTIVE);vault.deploy(msg.sender,amount);emit Drawn(id,msg.sender,amount,fee);
    }
    function receivePayout(uint256 id,uint256 amount) external onlyRouter {
        Position storage p=positions[id];if(p.status!=Status.ACTIVE)revert NotActive();uint256 principalDue=p.principal-p.principalRepaid;uint256 principalPaid=amount<principalDue?amount:principalDue;uint256 rest=amount-principalPaid;uint256 feeDue=p.fee-p.feeRepaid;uint256 feePaid=rest<feeDue?rest:feeDue;
        p.principalRepaid+=uint128(principalPaid);p.feeRepaid+=uint128(feePaid);if(principalPaid+feePaid>0){asset.approve(address(vault),principalPaid+feePaid);vault.receiveRepayment(principalPaid,feePaid);emit Repaid(id,principalPaid,feePaid);}if(amount>principalPaid+feePaid)asset.safeTransfer(p.agent,amount-principalPaid-feePaid);
        if(p.principalRepaid==p.principal&&p.feeRepaid==p.fee){p.status=Status.REPAID;return;}(,,,,,,,,IAverisACP.JobStatus s)=escrow.getJob(id);if(s==IAverisACP.JobStatus.COMPLETED)_closeLoss(id,p,Status.PARTIALLY_RECOVERED);
    }
    function finalizeDefault(uint256 id) external {Position storage p=positions[id];if(p.status!=Status.ACTIVE)revert NotActive();(,,,,,,,,IAverisACP.JobStatus s)=escrow.getJob(id);if(s==IAverisACP.JobStatus.REJECTED)_closeLoss(id,p,Status.DEFAULTED);else if(s==IAverisACP.JobStatus.EXPIRED)_closeLoss(id,p,Status.EXPIRED);else if(s==IAverisACP.JobStatus.COMPLETED)_closeLoss(id,p,Status.PARTIALLY_RECOVERED);else revert IneligibleJob();}
    function _closeLoss(uint256 id,Position storage p,Status s) private {uint256 loss=p.principal-p.principalRepaid;if(loss>0)vault.writeOff(loss);p.status=s;emit Defaulted(id,s,loss);}
    function _budget(uint256 id) private view returns(uint128){(,,,,,uint128 budget,,,)=escrow.getJob(id);return budget;}
}
