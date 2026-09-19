// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ── V1 contracts (unchanged) ──────────────────────────────────────────────────
import {AverisACP}             from "../src/AverisACP.sol";
import {AverisVault}           from "../src/AverisVault.sol";
import {ReceivableRouter, IFinancingPayout} from "../src/ReceivableRouter.sol";
import {MockUSDC}              from "../src/mocks/MockUSDC.sol";

// ── V2 contracts ──────────────────────────────────────────────────────────────
import {AverisCredit}          from "../src/AverisCredit.sol";
import {AverisAdapterRegistry} from "../src/AverisAdapterRegistry.sol";
import {AverisPoolFactory}     from "../src/AverisPoolFactory.sol";
import {AverisHood}            from "../src/AverisHood.sol";
import {AverisFinancingV2, IAverisVaultV2} from "../src/AverisFinancingV2.sol";
import {AverisJobPool}         from "../src/AverisJobPool.sol";
import {AverisACPAdapter, IAverisACPFull} from "../src/adapters/AverisACPAdapter.sol";
import {IJobAdapter}           from "../src/interfaces/IJobAdapter.sol";
import {AverisReserve}         from "../src/AverisReserve.sol";

interface Vm {
    function prank(address) external;
    function prank(address, address) external;
    function warp(uint256) external;
    function expectRevert() external;
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function addr(uint256) external returns (address);
}

// ── Helper: malicious ERC-20 recipient (reentrancy probe) ────────────────────
contract ReentrantRecipient {
    AverisJobPool public pool;
    bool          public attempted;
    function setPool(AverisJobPool p) external { pool = p; }
    // Fallback triggered by token transfer — tries to reenter spend()
    fallback() external {
        if (!attempted) {
            attempted = true;
            // Attempt reentrant spend — must revert with Reentrancy
            pool.spend(address(this), 1, bytes32(0));
        }
    }
}

contract AverisV2Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // ── Actors ────────────────────────────────────────────────────────────────
    address constant CLIENT    = address(0xC1E17);
    address constant EVALUATOR = address(0xEAA1);
    address constant LP        = address(0x1A1);
    address constant MONITOR   = address(0xA001);
    address constant RECIPIENT = address(0xFEED);
    address constant TREASURY  = address(0x7EA5);
    uint256 constant AGENT_PK  = 0xA6E17A6E17; // deterministic test key
    address          AGENT;                     // derived from AGENT_PK

    uint128 constant U = 1e6; // 1 USDC

    // ── Contracts ─────────────────────────────────────────────────────────────
    MockUSDC              usdc;
    AverisACP             acp;
    AverisVault           vault;
    ReceivableRouter      router;
    AverisCredit          creditEngine;
    AverisAdapterRegistry registry;
    AverisPoolFactory     factory;
    AverisHood            hood;
    AverisFinancingV2     financing;
    AverisACPAdapter      acpAdapter;
    AverisReserve         reserveFund;

    // ── Setup ─────────────────────────────────────────────────────────────────
    function setUp() public {
        AGENT = vm.addr(AGENT_PK);

        usdc     = new MockUSDC();
        acp      = new AverisACP();
        vault    = new AverisVault(usdc, address(this));
        router   = new ReceivableRouter(address(acp), usdc, address(this));

        creditEngine    = new AverisCredit();
        registry        = new AverisAdapterRegistry(address(this));
        factory         = new AverisPoolFactory(address(this));

        // Hood: 50 USDC per agent, 200 USDC total,
        //       NATIVE cap=50 USDC, VERIFIED cap=20 USDC, ATTESTED cap=5 USDC
        //       maxJobs=3, concentration=5000 (50%)
        hood = new AverisHood(
            address(this),
            50 * U,    // maxPerAgent
            200 * U,   // maxTotal
            50 * U,    // tierCapNative
            20 * U,    // tierCapVerified
            5 * U,     // tierCapAttested
            3,         // maxJobsPerAgent
            5000       // maxConcentrationBps (50%)
        );

        reserveFund = new AverisReserve(usdc, address(this));

        financing = new AverisFinancingV2(
            usdc,
            IAverisVaultV2(address(vault)),
            registry,
            creditEngine,
            address(router),
            factory,
            hood,
            address(this),  // owner
            2_000,          // 20% advance rate
            200,            // 2% fee
            50 * U,         // protocolMaximum
            20 * U,         // defaultPerTxLimit
            TREASURY,       // treasury address
            reserveFund,    // reserve fund
            AverisFinancingV2.FeeSplit(7_000, 2_000, 1_000) // 70/20/10
        );

        // Wire one-time setters
        vault.setFinancing(address(financing));
        router.setFinancing(IFinancingPayout(address(financing)));
        factory.setFinancing(address(financing));
        hood.setFinancing(address(financing));

        // Register native adapter
        acpAdapter = new AverisACPAdapter(IAverisACPFull(address(acp)), address(router));
        registry.registerAdapter(
            address(acp), 0, address(acpAdapter),
            IJobAdapter.AdapterTier.NATIVE, "AverisACP Native"
        );

        // Fund actors
        usdc.mint(CLIENT, 1000 * U);
        usdc.mint(LP,     1000 * U);
        usdc.mint(AGENT,  100  * U); // agent needs USDC for obligation repayment tests

        vm.prank(LP);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(LP);
        vault.deposit(100 * U, LP);

        hood.setMonitor(MONITOR);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════════════════

    function _fundJob(uint128 budget) internal returns (uint256 jobId) {
        jobId = acp.nextJobId();
        vm.prank(CLIENT);
        acp.createJob(AGENT, EVALUATOR, uint64(block.timestamp + 1 days), "job", address(0));
        vm.prank(AGENT);
        acp.setPayoutReceiver(jobId, address(router));
        vm.prank(AGENT);
        acp.setBudget(jobId, address(usdc), budget, "");
        vm.prank(CLIENT);
        usdc.approve(address(acp), budget);
        vm.prank(CLIENT);
        acp.fund(jobId, address(usdc), budget, "");
    }

    function _draw(uint256 jobId, uint128 amount) internal returns (address pool) {
        address[] memory recipients = new address[](1);
        recipients[0] = RECIPIENT;
        vm.prank(AGENT);
        financing.draw(address(acp), 0, jobId, amount, new bytes(0), recipients);
        pool = financing.getPool(jobId);
    }

    function _makeObligationSig(
        uint256 jobId,
        uint128 principal,
        uint128 fee_,
        uint64  expiry_
    ) internal returns (bytes memory) {
        uint256 nonce = financing.obligationNonce(AGENT);
        bytes32 structHash = keccak256(abi.encode(
            financing.OBLIGATION_TYPEHASH(),
            AGENT,
            address(acp),
            jobId,
            principal,
            fee_,
            expiry_,
            nonce,
            block.chainid
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", financing.DOMAIN_SEPARATOR(), structHash
        ));
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(AGENT_PK, digest);
        return abi.encodePacked(r_, s_, v_);
    }

    function _eq(uint256 a, uint256 b) internal pure { require(a == b, "eq failed"); }
    function _assertZero(uint256 a) internal pure { require(a == 0, "not zero"); }

    // ═══════════════════════════════════════════════════════════════════════════
    // A. ADAPTER TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function testACPAdapterReturnsCorrectJobView() public {
        uint256 jobId = _fundJob(100 * U);
        IJobAdapter.JobView memory jv = acpAdapter.getJob(jobId);
        _eq(jv.budget, 100 * U);
        require(jv.agent == AGENT, "agent mismatch");
        require(jv.payoutReceiver == address(router), "receiver mismatch");
        require(jv.repayMode == IJobAdapter.RepayMode.LIEN, "should be LIEN");
        require(jv.state == IJobAdapter.JobState.FUNDED, "should be FUNDED");
        require(jv.tier == IJobAdapter.AdapterTier.NATIVE, "should be NATIVE");
    }

    function testACPAdapterRejectsUnfundedJob() public {
        // Create but don't fund
        vm.prank(CLIENT);
        acp.createJob(AGENT, EVALUATOR, uint64(block.timestamp + 1 days), "x", address(0));
        // getJob on OPEN job — state maps to NONE, draw() should revert on it
        IJobAdapter.JobView memory jv = acpAdapter.getJob(1);
        require(jv.state == IJobAdapter.JobState.NONE, "should be NONE for OPEN job");
    }

    function testUnregisteredAdapterReturnsZero() public {
        // maxAdvance returns 0 for unregistered adapters (view function, safe default)
        address fakeProtocol = address(0xDEAD);
        uint256 result = financing.maxAdvance(fakeProtocol, 0, 1);
        _assertZero(result);
    }

    function testUnregisteredAdapterDrawReverts() public {
        // draw() reverts with AdapterInactive for unregistered adapters
        uint256 jobId = _fundJob(100 * U);
        address fakeProtocol = address(0xDEAD);
        address[] memory r = new address[](0);
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(fakeProtocol, 0, jobId, 5 * U, new bytes(0), r);
    }

    function testDeactivatedAdapterReverts() public {
        uint256 jobId = _fundJob(100 * U);
        registry.deactivateAdapter(address(acpAdapter));
        address[] memory r = new address[](0);
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, 5 * U, new bytes(0), r);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // B. POOL CREATION AND BASIC DRAW
    // ═══════════════════════════════════════════════════════════════════════════

    function testPoolCreatedOnDraw() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 5 * U);
        require(pool != address(0), "pool not deployed");
        // Vault balance decreased by drawn amount
        _eq(vault.availableLiquidity(), 95 * U);
        // Pool holds the capital
        _eq(usdc.balanceOf(pool), 5 * U);
        // Agent wallet received nothing
        _eq(usdc.balanceOf(AGENT), 100 * U); // unchanged from setUp mint
    }

    function testPositionRecordsPool() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 5 * U);
        AverisFinancingV2.Position memory p = financing.getPosition(jobId);
        require(p.poolAddress == pool, "pool address mismatch");
        _eq(uint256(p.principal), 5 * U);
        require(p.status == AverisFinancingV2.Status.ACTIVE, "not ACTIVE");
    }

    function testDoubleFinancingReverts() public {
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);
        address[] memory r = new address[](0);
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, 5 * U, new bytes(0), r);
    }

    function testNonAgentDrawReverts() public {
        uint256 jobId = _fundJob(100 * U);
        address[] memory r = new address[](0);
        // CLIENT tries to draw
        vm.prank(CLIENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, 5 * U, new bytes(0), r);
    }

    function testDrawWithoutRouterAsReceiverReverts() public {
        // Fund job but set provider address as receiver instead of router
        uint256 jobId = acp.nextJobId();
        vm.prank(CLIENT);
        acp.createJob(AGENT, EVALUATOR, uint64(block.timestamp + 1 days), "x", address(0));
        vm.prank(AGENT);
        acp.setPayoutReceiver(jobId, AGENT); // wrong receiver
        vm.prank(AGENT);
        acp.setBudget(jobId, address(usdc), 100 * U, "");
        vm.prank(CLIENT);
        usdc.approve(address(acp), 100 * U);
        vm.prank(CLIENT);
        acp.fund(jobId, address(usdc), 100 * U, "");
        address[] memory r = new address[](0);
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, 5 * U, new bytes(0), r);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // C. POOL SPENDING CONTROLS
    // ═══════════════════════════════════════════════════════════════════════════

    function testAgentCanSpendToAllowedRecipient() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);
        vm.prank(AGENT);
        AverisJobPool(pool).spend(RECIPIENT, 3 * U, bytes32("work-tool"));
        _eq(usdc.balanceOf(RECIPIENT), 3 * U);
        _eq(AverisJobPool(pool).totalSpent(), 3 * U);
    }

    function testSpendToDisallowedRecipientReverts() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);
        vm.prank(AGENT);
        vm.expectRevert();
        AverisJobPool(pool).spend(address(0xBAD), 1 * U, bytes32(0));
    }

    function testNonAgentSpendReverts() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);
        vm.prank(CLIENT);
        vm.expectRevert();
        AverisJobPool(pool).spend(RECIPIENT, 1 * U, bytes32(0));
    }

    function testSpendAfterExpiryReverts() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);
        vm.warp(block.timestamp + 2 days);
        vm.prank(AGENT);
        vm.expectRevert();
        AverisJobPool(pool).spend(RECIPIENT, 1 * U, bytes32(0));
    }

    function testSpendAfterFreezeReverts() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);
        // Hood freezes the pool
        hood.freezePool(pool);
        require(AverisJobPool(pool).frozen(), "not frozen");
        vm.prank(AGENT);
        vm.expectRevert();
        AverisJobPool(pool).spend(RECIPIENT, 1 * U, bytes32(0));
    }

    function testSpendExceedingApprovedAmountReverts() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 5 * U);
        vm.prank(AGENT);
        vm.expectRevert();
        AverisJobPool(pool).spend(RECIPIENT, 6 * U, bytes32(0));
    }

    function testPerTxLimitEnforced() public {
        uint256 jobId = _fundJob(100 * U);
        // maxAdvance on 100 USDC at 20% = 20 USDC; draw 15 USDC (within limit)
        address pool  = _draw(jobId, 15 * U);
        // defaultPerTxLimit is 20 USDC — spending 21 should revert
        vm.prank(AGENT);
        vm.expectRevert();
        AverisJobPool(pool).spend(RECIPIENT, 21 * U, bytes32(0));
        // Spending 15 (all available) should succeed
        vm.prank(AGENT);
        AverisJobPool(pool).spend(RECIPIENT, 15 * U, bytes32(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // D. HOOD TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function testHoodPauseBlocksDraw() public {
        uint256 jobId = _fundJob(100 * U);
        hood.pause();
        require(hood.paused(), "not paused");
        address[] memory r = new address[](0);
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, 5 * U, new bytes(0), r);
    }

    function testHoodUnpauseAllowsDraw() public {
        uint256 jobId = _fundJob(100 * U);
        hood.pause();
        hood.unpause();
        _draw(jobId, 5 * U); // must not revert
    }

    function testHoodAgentExposureLimitBlocks() public {
        // Set per-agent limit to 1 USDC cent — any draw of 1 USDC reverts
        hood.setExposureLimits(1, 200 * U); // 1 = 0.000001 USDC
        uint256 jobId = _fundJob(100 * U);
        address[] memory r = new address[](0);
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, 1 * U, new bytes(0), r);
    }

    function testHoodTierCapApplied() public {
        // NATIVE tier cap is 50 USDC; try to draw 51
        // Max advance for 100 USDC job at 20% = 20 USDC (less than 50), so tier cap not the binding constraint here
        // Raise advanceRate to expose tier cap
        financing.setParameters(10_000, 200, 200 * U, 200 * U);
        uint256 jobId = _fundJob(100 * U);
        uint256 ma = financing.maxAdvance(address(acp), 0, jobId);
        // With 10_000 bps and 100 USDC budget, advanceCap = 100 * U but tier cap = 50 * U
        require(ma <= 50 * U, "tierCap not applied");
    }

    function testHoodMaxJobsPerAgentBlocks() public {
        // maxJobsPerAgent = 3; draw 3 jobs then try a 4th
        financing.setParameters(2_000, 200, 200 * U, 200 * U);
        // Draw job 1
        uint256 j1 = _fundJob(100 * U); _draw(j1, 5 * U);
        // Separately funded jobs
        usdc.mint(CLIENT, 300 * U);
        uint256 j2 = _fundJob(100 * U); _draw(j2, 5 * U);
        uint256 j3 = _fundJob(100 * U); _draw(j3, 5 * U);
        // 4th draw must revert
        uint256 j4 = _fundJob(100 * U);
        address[] memory r = new address[](0);
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, j4, 5 * U, new bytes(0), r);
    }

    function testHoodReleaseOnRepayment() public {
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);
        _eq(hood.agentExposure(AGENT), 5 * U);

        vm.prank(AGENT);
        acp.submit(jobId, bytes32("work"), "");
        vm.prank(EVALUATOR);
        acp.complete(jobId, bytes32("ok"), "");

        _eq(hood.agentExposure(AGENT), 0);
    }

    function testHoodReleaseOnDefault() public {
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);
        _eq(hood.agentExposure(AGENT), 5 * U);

        vm.prank(EVALUATOR);
        acp.reject(jobId, bytes32("no"), "");
        financing.finalizeDefault(jobId);

        _eq(hood.agentExposure(AGENT), 0);
    }

    function testMonitorCanFreezePool() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);
        require(!AverisJobPool(pool).frozen(), "already frozen");
        vm.prank(MONITOR);
        hood.freezePool(pool);
        require(AverisJobPool(pool).frozen(), "not frozen after monitor");
    }

    function testMonitorCannotPause() public {
        vm.prank(MONITOR);
        vm.expectRevert();
        hood.pause();
    }

    function testMonitorCannotSetParameters() public {
        vm.prank(MONITOR);
        vm.expectRevert();
        hood.setExposureLimits(0, 0);
    }

    function testRandomCallerCannotFreezePool() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);
        vm.prank(address(0xB001));
        vm.expectRevert();
        hood.freezePool(pool);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // E. DEFAULT / UNSPENT RECOVERY
    // ═══════════════════════════════════════════════════════════════════════════

    function testUnspentReturnedToVaultOnDefault() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);

        // Spend 3 USDC — 7 left unspent
        vm.prank(AGENT);
        AverisJobPool(pool).spend(RECIPIENT, 3 * U, bytes32("work"));

        uint256 vaultLiqBefore = vault.availableLiquidity();

        vm.prank(EVALUATOR);
        acp.reject(jobId, bytes32("no"), "");
        financing.finalizeDefault(jobId);

        // Vault should have recovered the 7 unspent USDC
        uint256 vaultLiqAfter = vault.availableLiquidity();
        require(vaultLiqAfter == vaultLiqBefore + 7 * U, "unspent not recovered");
    }

    function testNetLossIsUnspentAdjusted() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 10 * U);

        // Agent spends 4 USDC — 6 returned on default
        vm.prank(AGENT);
        AverisJobPool(pool).spend(RECIPIENT, 4 * U, bytes32("use"));

        // Record vault state
        uint256 outstandingBefore = vault.outstandingPrincipal();
        _eq(outstandingBefore, 10 * U);

        vm.prank(EVALUATOR);
        acp.reject(jobId, bytes32("no"), "");
        financing.finalizeDefault(jobId);

        // writeOff = principal - principalRepaid = 10 - 0 = 10
        // outstandingPrincipal = 10 - 10 = 0
        // vault.balance = 90 (post-deploy) + 6 (returnUnspent) = 96
        // totalAssets = balance(96) + outstanding(0) = 96
        // Real loss to LPs = 4 USDC (what agent actually spent)
        _eq(vault.outstandingPrincipal(), 0);
        _eq(vault.totalAssets(), 96 * U);
    }

    function testDoubleDefaultReverts() public {
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);
        vm.prank(EVALUATOR);
        acp.reject(jobId, bytes32("no"), "");
        financing.finalizeDefault(jobId);
        vm.expectRevert();
        financing.finalizeDefault(jobId);
    }

    function testPoolFrozenAfterDefault() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 5 * U);
        vm.prank(EVALUATOR);
        acp.reject(jobId, bytes32("no"), "");
        financing.finalizeDefault(jobId);
        require(AverisJobPool(pool).frozen(), "pool not frozen after default");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // F. FULL V2 SETTLEMENT (LIEN MODE)
    // ═══════════════════════════════════════════════════════════════════════════

    function testFullSettlementRepaysVaultAndPaysAgent() public {
        uint256 jobId = _fundJob(100 * U);
        address pool  = _draw(jobId, 5 * U);

        // Agent spends 2 USDC from the pool (optional — settlement still routes through router)
        vm.prank(AGENT);
        AverisJobPool(pool).spend(RECIPIENT, 2 * U, bytes32("tool"));

        vm.prank(AGENT);
        acp.submit(jobId, bytes32("work"), "");
        vm.prank(EVALUATOR);
        acp.complete(jobId, bytes32("done"), "");

        AverisFinancingV2.Position memory p = financing.getPosition(jobId);
        require(p.status == AverisFinancingV2.Status.REPAID, "not REPAID");
        // Fee = 2% of 5 USDC = 100_000 raw; LP share = 70% = 70_000
        // Vault totalAssets = 100 USDC + 0.07 USDC LP fee share
        _eq(vault.totalAssets(), 100 * U + 70_000);
    }

    function testSettlementReleasesHoodExposure() public {
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);
        _eq(hood.agentExposure(AGENT), 5 * U);

        vm.prank(AGENT);
        acp.submit(jobId, bytes32("w"), "");
        vm.prank(EVALUATOR);
        acp.complete(jobId, bytes32("ok"), "");

        _eq(hood.agentExposure(AGENT), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // G. OBLIGATION MODE
    // ═══════════════════════════════════════════════════════════════════════════

    function testObligationModeDrawSucceeds() public {
        // Fund job WITHOUT setting router as receiver
        uint256 jobId = acp.nextJobId();
        vm.prank(CLIENT);
        acp.createJob(AGENT, EVALUATOR, uint64(block.timestamp + 1 days), "ext", address(0));
        // NOTE: do NOT call setPayoutReceiver — obligation mode
        vm.prank(AGENT);
        acp.setBudget(jobId, address(usdc), 100 * U, "");
        vm.prank(CLIENT);
        usdc.approve(address(acp), 100 * U);
        vm.prank(CLIENT);
        acp.fund(jobId, address(usdc), 100 * U, "");

        // This job has no receiver set — adapter returns OBLIGATION mode
        IJobAdapter.JobView memory jv = acpAdapter.getJob(jobId);
        // payoutReceiver is address(0) so repayMode is OBLIGATION
        require(jv.repayMode == IJobAdapter.RepayMode.OBLIGATION, "should be OBLIGATION");

        uint128 principal = 5 * U;
        uint128 fee_      = uint128((uint256(principal) * 200 + 9_999) / 10_000);
        bytes memory sig  = _makeObligationSig(jobId, principal, fee_, uint64(block.timestamp + 1 days));

        address[] memory r = new address[](1);
        r[0] = RECIPIENT;
        vm.prank(AGENT);
        financing.draw(address(acp), 0, jobId, principal, sig, r);

        AverisFinancingV2.Position memory p = financing.getPosition(jobId);
        require(p.repayMode == IJobAdapter.RepayMode.OBLIGATION, "not OBLIGATION");
        require(p.status == AverisFinancingV2.Status.ACTIVE, "not ACTIVE");
    }

    function testObligationModeRepay() public {
        // Fund + draw in OBLIGATION mode (same setup as above)
        uint256 jobId = acp.nextJobId();
        vm.prank(CLIENT);
        acp.createJob(AGENT, EVALUATOR, uint64(block.timestamp + 1 days), "ext", address(0));
        vm.prank(AGENT);
        acp.setBudget(jobId, address(usdc), 100 * U, "");
        vm.prank(CLIENT);
        usdc.approve(address(acp), 100 * U);
        vm.prank(CLIENT);
        acp.fund(jobId, address(usdc), 100 * U, "");

        uint128 principal = 5 * U;
        uint128 fee_      = uint128((uint256(principal) * 200 + 9_999) / 10_000);
        bytes memory sig  = _makeObligationSig(jobId, principal, fee_, uint64(block.timestamp + 1 days));
        address[] memory r = new address[](1); r[0] = RECIPIENT;
        vm.prank(AGENT);
        financing.draw(address(acp), 0, jobId, principal, sig, r);

        // Agent repays via repayObligation
        uint256 totalDue = principal + fee_;
        vm.prank(AGENT);
        usdc.approve(address(financing), totalDue);
        vm.prank(AGENT);
        financing.repayObligation(jobId);

        AverisFinancingV2.Position memory p = financing.getPosition(jobId);
        require(p.status == AverisFinancingV2.Status.REPAID, "not REPAID");
    }

    function testObligationReplayReverts() public {
        uint256 jobId = acp.nextJobId();
        vm.prank(CLIENT);
        acp.createJob(AGENT, EVALUATOR, uint64(block.timestamp + 1 days), "ext2", address(0));
        vm.prank(AGENT);
        acp.setBudget(jobId, address(usdc), 100 * U, "");
        vm.prank(CLIENT);
        usdc.approve(address(acp), 100 * U);
        vm.prank(CLIENT);
        acp.fund(jobId, address(usdc), 100 * U, "");

        uint128 principal = 5 * U;
        uint128 fee_      = uint128((uint256(principal) * 200 + 9_999) / 10_000);
        bytes memory sig  = _makeObligationSig(jobId, principal, fee_, uint64(block.timestamp + 1 days));
        address[] memory r = new address[](1); r[0] = RECIPIENT;

        vm.prank(AGENT);
        financing.draw(address(acp), 0, jobId, principal, sig, r);

        // Attempt to draw the same job again with same sig → ExistingPosition
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, principal, sig, r);
    }

    function testObligationWrongSigReverts() public {
        uint256 jobId = acp.nextJobId();
        vm.prank(CLIENT);
        acp.createJob(AGENT, EVALUATOR, uint64(block.timestamp + 1 days), "ext3", address(0));
        vm.prank(AGENT);
        acp.setBudget(jobId, address(usdc), 100 * U, "");
        vm.prank(CLIENT);
        usdc.approve(address(acp), 100 * U);
        vm.prank(CLIENT);
        acp.fund(jobId, address(usdc), 100 * U, "");

        // Sign with wrong key
        bytes memory badSig = new bytes(65);
        address[] memory r = new address[](1); r[0] = RECIPIENT;
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, 5 * U, badSig, r);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // H. V1 COMPATIBILITY — all original tests as functions
    // ═══════════════════════════════════════════════════════════════════════════

    function testV1AtomicCompletionRepaysThenPaysRemainder() public {
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);
        vm.prank(AGENT);
        acp.submit(jobId, bytes32("work"), "");
        vm.prank(EVALUATOR);
        acp.complete(jobId, bytes32("ok"), "");
        AverisFinancingV2.Position memory p = financing.getPosition(jobId);
        require(p.status == AverisFinancingV2.Status.REPAID, "not REPAID");
        // Vault earns 70% of 2% fee on 5 USDC = 70_000 raw
        _eq(vault.totalAssets(), 100 * U + 70_000);
    }

    function testV1RejectWritesOffPrincipal() public {
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);
        vm.prank(EVALUATOR);
        acp.reject(jobId, bytes32("no"), "");
        financing.finalizeDefault(jobId);
        _eq(vault.outstandingPrincipal(), 0);
    }

    function testV1ExpiryRefundAndDefault() public {
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);
        vm.warp(block.timestamp + 2 days);
        acp.claimRefund(jobId);
        financing.finalizeDefault(jobId);
        _eq(vault.outstandingPrincipal(), 0);
    }

    function testV1ReceiverCannotChangeAfterFunding() public {
        uint256 jobId = _fundJob(100 * U);
        vm.prank(AGENT);
        vm.expectRevert();
        acp.setPayoutReceiver(jobId, AGENT);
    }

    function testV1SolvencyCapIncludesRoundedFee() public {
        financing.setParameters(10_000, 200, 200 * U, 200 * U);
        // Also raise hood tier cap so it is not the binding constraint
        hood.setTierCap(0, 200 * U);
        uint256 jobId = _fundJob(100 * U);
        uint256 cap = financing.maxAdvance(address(acp), 0, jobId);
        _eq(cap, 98_039_215);
        uint256 fee_ = (cap * 200 + 9_999) / 10_000;
        require(cap + fee_ <= 100 * U, "insolvent");
        address[] memory r = new address[](0);
        vm.prank(AGENT);
        vm.expectRevert();
        financing.draw(address(acp), 0, jobId, uint128(cap + 1), new bytes(0), r);
    }

    function testCreditEngineComputeBasic() public view {
        AverisCredit.CreditParams memory p = AverisCredit.CreditParams({
            budget:           100 * U,
            advanceRateBps:   2_000,
            feeBps:           200,
            agentCreditLimit: 0,
            protocolMaximum:  50 * U,
            tierCap:          50 * U,
            vaultLiquidity:   100 * U
        });
        uint256 result = creditEngine.compute(p);
        // advanceCap = 20 USDC; solvencyCap = ~98 USDC; agentCap = 50 USDC
        // min = 20 USDC
        _eq(result, 20 * U);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // I. FEE SPLIT (Option B: 70% LP / 20% treasury / 10% reserve)
    // ═══════════════════════════════════════════════════════════════════════════

    function testFeeSplitOnLienRepayment() public {
        // Fee = 2% of 5 USDC = 100_000 raw
        // LP   70% = 70_000
        // Treasury 20% = 20_000
        // Reserve  10% = 10_000
        uint256 jobId = _fundJob(100 * U);
        _draw(jobId, 5 * U);

        uint256 treasuryBefore = usdc.balanceOf(TREASURY);
        uint256 reserveBefore  = usdc.balanceOf(address(reserveFund));
        uint256 vaultBefore    = vault.totalAssets();

        vm.prank(AGENT);
        acp.submit(jobId, bytes32("work"), "");
        vm.prank(EVALUATOR);
        acp.complete(jobId, bytes32("done"), "");

        // Treasury received 20% of fee
        _eq(usdc.balanceOf(TREASURY) - treasuryBefore, 20_000);
        // Reserve received 10% of fee
        _eq(usdc.balanceOf(address(reserveFund)) - reserveBefore, 10_000);
        // Vault NAV increased by 70% of fee
        _eq(vault.totalAssets() - vaultBefore + 5 * U, 5 * U + 70_000);
    }

    function testFeeSplitOnObligationRepay() public {
        // Set up obligation mode draw
        uint256 jobId = acp.nextJobId();
        vm.prank(CLIENT);
        acp.createJob(AGENT, EVALUATOR, uint64(block.timestamp + 1 days), "oblFee", address(0));
        vm.prank(AGENT);
        acp.setBudget(jobId, address(usdc), 100 * U, "");
        vm.prank(CLIENT);
        usdc.approve(address(acp), 100 * U);
        vm.prank(CLIENT);
        acp.fund(jobId, address(usdc), 100 * U, "");

        uint128 principal = 5 * U;
        uint128 fee_      = uint128((uint256(principal) * 200 + 9_999) / 10_000);
        bytes memory sig  = _makeObligationSig(jobId, principal, fee_, uint64(block.timestamp + 1 days));
        address[] memory r = new address[](1); r[0] = RECIPIENT;
        vm.prank(AGENT);
        financing.draw(address(acp), 0, jobId, principal, sig, r);

        uint256 treasuryBefore = usdc.balanceOf(TREASURY);
        uint256 reserveBefore  = usdc.balanceOf(address(reserveFund));

        uint256 totalDue = uint256(principal) + uint256(fee_);
        vm.prank(AGENT);
        usdc.approve(address(financing), totalDue);
        vm.prank(AGENT);
        financing.repayObligation(jobId);

        // fee_ = 100_000; treasury 20% = 20_000; reserve 10% = 10_000
        _eq(usdc.balanceOf(TREASURY) - treasuryBefore, 20_000);
        _eq(usdc.balanceOf(address(reserveFund)) - reserveBefore, 10_000);
    }

    function testReserveOwnerCanDraw() public {
        // Simulate reserve accumulation
        usdc.mint(address(reserveFund), 50 * U);
        uint256 before = usdc.balanceOf(address(this));
        reserveFund.draw(address(this), 10 * U, "test drawdown");
        _eq(usdc.balanceOf(address(this)) - before, 10 * U);
    }

    function testReserveNonOwnerCannotDraw() public {
        usdc.mint(address(reserveFund), 10 * U);
        vm.prank(address(0xBAD));
        vm.expectRevert();
        reserveFund.draw(address(0xBAD), 1 * U, "hack attempt");
    }

    function testSetTreasuryUpdatesAddress() public {
        address newTreasury = address(0xBEEF1);
        financing.setTreasury(newTreasury);
        require(financing.treasury() == newTreasury, "treasury not updated");
    }

    function testSetFeeSplitMustSumTo10000() public {
        vm.expectRevert();
        financing.setFeeSplit(5_000, 2_000, 1_000); // sums to 8000 — should revert
    }

    function testSetFeeSplitValidUpdate() public {
        financing.setFeeSplit(6_000, 3_000, 1_000); // 60/30/10 — valid
        (uint16 lpBps, uint16 tBps, uint16 rBps) = financing.feeSplit();
        require(lpBps == 6_000 && tBps == 3_000 && rBps == 1_000, "split not updated");
    }
}

