// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ExternalJobAdapter}    from "../src/ExternalJobAdapter.sol";
import {IJobAdapter}           from "../src/interfaces/IJobAdapter.sol";
import {IExternalJob}          from "../src/interfaces/IExternalJob.sol";
import {AverisAdapterRegistry} from "../src/AverisAdapterRegistry.sol";
import {AverisACP}             from "../src/AverisACP.sol";
import {AverisVault}           from "../src/AverisVault.sol";
import {AverisCredit}          from "../src/AverisCredit.sol";
import {AverisPoolFactory}     from "../src/AverisPoolFactory.sol";
import {AverisHood}            from "../src/AverisHood.sol";
import {AverisFinancingV2, IAverisVaultV2} from "../src/AverisFinancingV2.sol";
import {AverisReserve}         from "../src/AverisReserve.sol";
import {ReceivableRouter, IFinancingPayout} from "../src/ReceivableRouter.sol";
import {MockUSDC}              from "../src/mocks/MockUSDC.sol";

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert() external;
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function addr(uint256) external returns (address);
}

// ── Mock external job platform ────────────────────────────────────────────────
/// @dev Simulates an ERC-8183-compatible external job contract.
contract MockExternalPlatform {
    struct Job {
        address client;
        address provider;
        address evaluator;
        address payoutReceiver;
        address token;
        uint128 budget;
        uint128 settledAmount;
        uint64  expiry;
        IExternalJob.JobStatus status;
    }

    mapping(uint256 => Job) private _jobs;
    uint256 public nextId = 1;
    bool    public setReceiverReverts; // toggle to simulate unsupported setPayoutReceiver

    function createJob(
        address provider,
        address evaluator,
        address token,
        uint128 budget,
        uint64  expiry
    ) external returns (uint256 id) {
        id = nextId++;
        _jobs[id] = Job({
            client:         msg.sender,
            provider:       provider,
            evaluator:      evaluator,
            payoutReceiver: address(0),
            token:          token,
            budget:         budget,
            settledAmount:  0,
            expiry:         expiry,
            status:         IExternalJob.JobStatus.FUNDED
        });
    }

    function setPayoutReceiver(uint256 id, address receiver) external {
        if (setReceiverReverts) revert("unsupported");
        _jobs[id].payoutReceiver = receiver;
    }

    function getJob(uint256 id)
        external
        view
        returns (
            address, address, address, address, address,
            uint128, uint128, uint64, IExternalJob.JobStatus
        )
    {
        Job memory j = _jobs[id];
        require(j.budget > 0, "not found");
        return (
            j.client, j.provider, j.evaluator, j.payoutReceiver, j.token,
            j.budget, j.settledAmount, j.expiry, j.status
        );
    }

    function setReceiverSupport(bool supported) external {
        setReceiverReverts = !supported;
    }
}

// ── Test contract ─────────────────────────────────────────────────────────────
contract ExternalJobAdapterTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address constant CLIENT    = address(0xC1E17);
    address constant EVALUATOR = address(0xEAA1);
    address constant LP        = address(0x1A1);
    address constant TREASURY  = address(0x7EA5);
    uint256 constant AGENT_PK  = 0xEA6ADAF7E8;
    address          AGENT;

    uint128 constant U = 1e6; // 1 USDC

    MockUSDC              usdc;
    MockExternalPlatform  extPlatform;
    ExternalJobAdapter    adapter;
    AverisAdapterRegistry registry;

    // Full Averis stack for integration tests
    AverisVault       vault;
    AverisCredit      creditEngine;
    AverisPoolFactory factory;
    AverisHood        hood;
    AverisFinancingV2 financing;
    AverisReserve     reserveFund;
    ReceivableRouter  router;
    AverisACP         acp; // not used by external jobs but needed for router

    function setUp() public {
        AGENT = vm.addr(AGENT_PK);

        usdc        = new MockUSDC();
        extPlatform = new MockExternalPlatform();
        adapter     = new ExternalJobAdapter(address(this), address(usdc), address(extPlatform));
        registry    = new AverisAdapterRegistry(address(this));

        // ── Full Averis V2 stack ──────────────────────────────────────────────
        acp          = new AverisACP();
        vault        = new AverisVault(usdc, address(this));
        router       = new ReceivableRouter(address(acp), usdc, address(this));
        creditEngine = new AverisCredit();
        factory      = new AverisPoolFactory(address(this));
        hood         = new AverisHood(
            address(this),
            100_000 * U,   // maxPerAgent
            500_000 * U,   // maxTotal
            10_000 * U,    // tierCapNative
            10_000 * U,    // tierCapVerified
            10_000 * U,    // tierCapAttested
            5,             // maxJobsPerAgent
            5000           // maxConcentrationBps
        );
        reserveFund  = new AverisReserve(usdc, address(this));

        financing = new AverisFinancingV2(
            usdc,
            IAverisVaultV2(address(vault)),
            registry,
            creditEngine,
            address(router),
            factory,
            hood,
            address(this),
            4000,          // 40% advance rate
            200,           // 2% fee
            500_000 * U,   // protocol max
            10_000 * U,    // per-tx limit
            TREASURY,
            reserveFund,
            AverisFinancingV2.FeeSplit(7000, 2000, 1000)
        );

        vault.setFinancing(address(financing));
        factory.setFinancing(address(financing));
        router.setFinancing(IFinancingPayout(address(financing)));
        hood.setFinancing(address(financing));

        // Register the ExternalJobAdapter in the registry
        registry.registerAdapter(
            address(extPlatform),
            0,
            address(adapter),
            IJobAdapter.AdapterTier.ATTESTED,
            "MockExternalPlatform"
        );

        // Seed vault liquidity
        usdc.mint(LP, 10_000 * U);
        vm.prank(LP);
        usdc.approve(address(vault), 10_000 * U);
        vm.prank(LP);
        vault.deposit(10_000 * U, LP);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    function _createFundedJob(uint128 budget, uint64 expiry) internal returns (uint256 jobId) {
        usdc.mint(CLIENT, budget);
        vm.prank(CLIENT);
        jobId = extPlatform.createJob(AGENT, EVALUATOR, address(usdc), budget, expiry);
    }

    // ── Section A: Adapter unit tests ─────────────────────────────────────────

    /// A1. tier() returns ATTESTED
    function testTierIsAttested() public {
        assert(adapter.tier() == IJobAdapter.AdapterTier.ATTESTED);
    }

    /// A2. getJob() correctly maps FUNDED external status
    function testGetJobFunded() public {
        uint256 jobId = _createFundedJob(1000 * U, uint64(block.timestamp + 1 days));
        IJobAdapter.JobView memory jv = adapter.getJob(jobId);
        assert(jv.state      == IJobAdapter.JobState.FUNDED);
        assert(jv.agent      == AGENT);
        assert(jv.budget     == 1000 * U);
        assert(jv.token      == address(usdc));
        assert(jv.repayMode  == IJobAdapter.RepayMode.LIEN); // USDC => LIEN
    }

    /// A3. getJob() reverts for non-existent jobId
    function testGetJobReverts_NotFound() public {
        vm.expectRevert();
        adapter.getJob(9999);
    }

    /// A4. Non-USDC token maps to OBLIGATION repay mode
    function testGetJob_NonUsdcToken_ObligationMode() public {
        MockUSDC otherToken = new MockUSDC();
        otherToken.mint(CLIENT, 1000 * U);
        vm.prank(CLIENT);
        uint256 jobId = extPlatform.createJob(
            AGENT, EVALUATOR, address(otherToken), 1000 * U,
            uint64(block.timestamp + 1 days)
        );
        IJobAdapter.JobView memory jv = adapter.getJob(jobId);
        assert(jv.repayMode == IJobAdapter.RepayMode.OBLIGATION);
    }

    // ── Section B: setLien ────────────────────────────────────────────────────

    /// B1. setLien succeeds when platform supports setPayoutReceiver
    function testSetLien_Success() public {
        uint256 jobId = _createFundedJob(1000 * U, uint64(block.timestamp + 1 days));
        address router_ = address(0xBEEF);
        vm.prank(AGENT);
        bool ok = adapter.setLien(jobId, router_);
        assert(ok);
    }

    /// B2. setLien returns false (not reverts) when platform does NOT support receiver mutation
    function testSetLien_FallbackToObligation() public {
        extPlatform.setReceiverSupport(false);
        uint256 jobId = _createFundedJob(1000 * U, uint64(block.timestamp + 1 days));
        vm.prank(AGENT);
        bool ok = adapter.setLien(jobId, address(0xBEEF));
        assert(!ok); // must return false, not revert
    }

    // ── Section C: Platform management ───────────────────────────────────────

    /// C1. Only owner can call setPlatform
    function testSetPlatform_OnlyOwner() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        adapter.setPlatform(address(0x1234));
    }

    /// C2. Owner can update platform
    function testSetPlatform_Owner() public {
        MockExternalPlatform newPlatform = new MockExternalPlatform();
        adapter.setPlatform(address(newPlatform));
        assert(adapter.platform() == address(newPlatform));
        assert(!adapter.whitelisted(address(extPlatform)));
        assert(adapter.whitelisted(address(newPlatform)));
    }

    /// C3. setPlatform reverts on zero address
    function testSetPlatform_ZeroAddress() public {
        vm.expectRevert();
        adapter.setPlatform(address(0));
    }

    // ── Section D: Integration with AverisFinancingV2 ─────────────────────────

    /// D1. Full draw via ExternalJobAdapter — LIEN mode happy path
    function testDraw_ExternalJob_LienMode() public {
        uint256 jobId = _createFundedJob(1000 * U, uint64(block.timestamp + 7 days));

        // Agent sets lien (wires router as payout receiver) before draw
        vm.prank(AGENT);
        bool lienSet = adapter.setLien(jobId, address(router));
        assert(lienSet);

        // Check max advance
        uint128 adv = uint128(financing.maxAdvance(address(extPlatform), 0, jobId));
        assert(adv > 0); // 40% of 1000 = 400 USDC

        // Agent draws
        vm.prank(AGENT);
        address[] memory recips = new address[](0);
        financing.draw(address(extPlatform), 0, jobId, adv, bytes(""), recips);

        // Pool exists and has the advance
        (,address pool,,,,,,,,) = financing.positions(jobId);
        assert(pool != address(0));
        assert(usdc.balanceOf(pool) == adv);
    }

    /// D2. draw reverts when platform is NOT registered in registry
    function testDraw_UnregisteredPlatform_Reverts() public {
        MockExternalPlatform unregistered = new MockExternalPlatform();
        usdc.mint(CLIENT, 1000 * U);
        vm.prank(CLIENT);
        uint256 jobId = unregistered.createJob(
            AGENT, EVALUATOR, address(usdc), 1000 * U,
            uint64(block.timestamp + 7 days)
        );
        vm.prank(AGENT);
        vm.expectRevert();
        address[] memory recips2 = new address[](0);
        financing.draw(address(unregistered), 0, jobId, 400 * U, bytes(""), recips2);
    }

    /// D3. draw reverts on expired job
    function testDraw_ExpiredJob_Reverts() public {
        uint256 jobId = _createFundedJob(1000 * U, uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 10); // expire it
        vm.prank(AGENT);
        vm.expectRevert();
        address[] memory recips3 = new address[](0);
        financing.draw(address(extPlatform), 0, jobId, 400 * U, bytes(""), recips3);
    }

    /// D4. maxAdvance returns 0 for expired job
    function testMaxAdvance_ExpiredJob_ReturnsZero() public {
        uint256 jobId = _createFundedJob(1000 * U, uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 10);
        uint256 adv = financing.maxAdvance(address(extPlatform), 0, jobId);
        assert(adv == 0);
    }

    /// D5. maxAdvance respects ATTESTED tier Hood cap
    function testMaxAdvance_RespectsTierCap() public {
        // Set ATTESTED cap very low — 50 USDC
        hood.setTierCap(uint8(IJobAdapter.AdapterTier.ATTESTED), 50 * U);
        uint256 jobId = _createFundedJob(1000 * U, uint64(block.timestamp + 7 days));
        uint256 adv = financing.maxAdvance(address(extPlatform), 0, jobId);
        assert(adv <= 50 * U);
    }
}
