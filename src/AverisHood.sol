// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IJobAdapter} from "./interfaces/IJobAdapter.sol";
import {AverisJobPool} from "./AverisJobPool.sol";

/// @notice Full risk layer for Averis V2.
/// Controls: per-agent exposure limits, per-tier credit caps, concentration
/// limits (max jobs per agent, max share of total exposure), circuit breaker
/// (global pause), and anomaly freeze (monitor key → freezePool only).
///
/// Funds NEVER flow through Hood. Hood is a pure authorization/accounting layer.
contract AverisHood {
    error Unauthorized();
    error Paused();
    error ExceedsAgentLimit();
    error ExceedsTotalLimit();
    error ExceedsJobLimit();
    error ExceedsConcentration();
    error AlreadySet();

    address public immutable owner;
    address public financing;   // set once by owner after deploy
    address public monitor;     // freeze-only key; no fund access

    // ── Circuit breaker ───────────────────────────────────────────────────────
    bool public paused;

    // ── Exposure accounting ───────────────────────────────────────────────────
    mapping(address => uint128) public agentExposure;
    uint128 public totalExposure;
    uint128 public maxExposurePerAgent;
    uint128 public maxExposureTotal;

    // ── Adapter tier caps (NATIVE=0, VERIFIED=1, ATTESTED=2) ─────────────────
    mapping(uint8 => uint128) public tierCap;

    // ── Concentration limits ──────────────────────────────────────────────────
    mapping(address => uint32) public activeJobCount;
    uint8  public maxJobsPerAgent;
    uint16 public maxConcentrationBps; // e.g. 2000 = 20%

    event Recorded(address indexed agent, uint128 amount, uint128 agentTotal, uint128 globalTotal);
    event Released(address indexed agent, uint128 amount);
    event PoolFrozen(address indexed pool, address indexed caller);
    event ProtocolPaused(address indexed caller);
    event ProtocolUnpaused(address indexed caller);
    event MonitorSet(address indexed monitor);
    event FinancingSet(address indexed financing);

    constructor(
        address owner_,
        uint128 maxPerAgent_,
        uint128 maxTotal_,
        uint128 tierCapNative_,
        uint128 tierCapVerified_,
        uint128 tierCapAttested_,
        uint8   maxJobs_,
        uint16  maxConcentrationBps_
    ) {
        require(owner_ != address(0), "zero owner");
        owner                = owner_;
        maxExposurePerAgent  = maxPerAgent_;
        maxExposureTotal     = maxTotal_;
        tierCap[0]           = tierCapNative_;
        tierCap[1]           = tierCapVerified_;
        tierCap[2]           = tierCapAttested_;
        maxJobsPerAgent      = maxJobs_;
        maxConcentrationBps  = maxConcentrationBps_;
    }

    modifier onlyOwner()     { if (msg.sender != owner)     revert Unauthorized(); _; }
    modifier onlyFinancing() { if (msg.sender != financing) revert Unauthorized(); _; }

    // ── Wiring ────────────────────────────────────────────────────────────────

    function setFinancing(address f) external onlyOwner {
        if (financing != address(0)) revert AlreadySet();
        financing = f;
        emit FinancingSet(f);
    }

    function setMonitor(address m) external onlyOwner {
        monitor = m;
        emit MonitorSet(m);
    }

    // ── Configuration ─────────────────────────────────────────────────────────

    function setExposureLimits(uint128 perAgent, uint128 total) external onlyOwner {
        maxExposurePerAgent = perAgent;
        maxExposureTotal    = total;
    }

    function setTierCap(uint8 tier, uint128 cap) external onlyOwner {
        tierCap[tier] = cap;
    }

    function setConcentrationLimits(uint8 maxJobs, uint16 concentrationBps) external onlyOwner {
        require(concentrationBps <= 10_000, "bps > 10000");
        maxJobsPerAgent     = maxJobs;
        maxConcentrationBps = concentrationBps;
    }

    // ── Credit tier cap view ──────────────────────────────────────────────────

    function tierCapFor(IJobAdapter.AdapterTier t) external view returns (uint128) {
        return tierCap[uint8(t)];
    }

    // ── Draw-time gate (called by AverisFinancing before vault.deploy) ────────

    /// @notice Record new exposure for an agent. Reverts on any violation.
    /// Called atomically inside AverisFinancing.draw() before fund movement.
    function checkAndRecord(address agent, uint128 amount) external onlyFinancing {
        if (paused) revert Paused();

        uint128 newAgentExposure = agentExposure[agent] + amount;
        uint128 newTotalExposure = totalExposure + amount;

        if (maxExposurePerAgent > 0 && newAgentExposure > maxExposurePerAgent)
            revert ExceedsAgentLimit();
        if (maxExposureTotal > 0 && newTotalExposure > maxExposureTotal)
            revert ExceedsTotalLimit();
        if (maxJobsPerAgent > 0 && activeJobCount[agent] >= maxJobsPerAgent)
            revert ExceedsJobLimit();
        // Concentration check: new agent share must not exceed maxConcentrationBps.
        // Only meaningful when OTHER agents already have exposure. Skipped when
        // totalExposure == agentExposure[agent] (this agent owns all existing exposure)
        // to avoid false positives on the first draw or when only one agent is active.
        uint128 otherExposure = totalExposure - agentExposure[agent]; // exposure from other agents
        if (maxConcentrationBps > 0 && otherExposure > 0) {
            // newAgentExposure / newTotalExposure <= maxConcentrationBps / 10_000
            // ↔ newAgentExposure * 10_000 <= newTotalExposure * maxConcentrationBps
            if (uint256(newAgentExposure) * 10_000 > uint256(newTotalExposure) * maxConcentrationBps)
                revert ExceedsConcentration();
        }

        agentExposure[agent] = newAgentExposure;
        totalExposure        = newTotalExposure;
        activeJobCount[agent]++;
        emit Recorded(agent, amount, newAgentExposure, newTotalExposure);
    }

    /// @notice Decrement exposure on repayment or default finalization.
    function releaseExposure(address agent, uint128 amount) external onlyFinancing {
        // Guard against underflow from accounting mismatches
        uint128 ae = agentExposure[agent];
        uint128 te = totalExposure;
        uint128 actualAgent = ae >= amount ? amount : ae;
        uint128 actualTotal = te >= amount ? amount : te;
        agentExposure[agent] -= actualAgent;
        totalExposure        -= actualTotal;
        if (activeJobCount[agent] > 0) activeJobCount[agent]--;
        emit Released(agent, actualAgent);
    }

    // ── Emergency controls ────────────────────────────────────────────────────

    function pause() external onlyOwner {
        paused = true;
        emit ProtocolPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit ProtocolUnpaused(msg.sender);
    }

    /// @notice Freeze a specific pool. Callable by owner OR monitor key.
    /// Monitor has NO other permissions — it cannot move funds or change config.
    function freezePool(address pool) external {
        if (msg.sender != owner && msg.sender != monitor) revert Unauthorized();
        AverisJobPool(pool).freeze();
        emit PoolFrozen(pool, msg.sender);
    }
}
