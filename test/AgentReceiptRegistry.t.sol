// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/passport/AgentReceiptRegistry.sol";
import "../src/interfaces/IAgentPassport.sol";

contract AgentReceiptRegistryTest is Test {

    AgentReceiptRegistry public reg;

    address internal owner   = address(this);
    address internal agent   = address(0xA11CE);
    address internal agent2  = address(0xB0B);
    address internal issuer  = address(0x1550E2);  // simulates AverisFinancingV2
    address internal nobody  = address(0xDEAD);

    bytes32 constant TX_HASH  = bytes32(uint256(0x1234));
    bytes32 constant EV_HASH  = keccak256('{"type":"FINANCING","amount":40000000}');
    uint256 constant AGENT_ID = 42;

    function setUp() public {
        reg = new AgentReceiptRegistry();
        reg.setAuthorizedIssuer(issuer, true);
    }

    // ── Section A: Authorized issuer anchoring ────────────────────────────────

    function testAuthorizedIssuerAnchorsAsAverisVerified() public {
        vm.prank(issuer);
        uint256 id = reg.anchorReceipt(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.FINANCING);

        AgentReceiptRegistry.ReceiptAnchor memory r = reg.getReceipt(id);
        assertEq(r.receiptId,        id);
        assertEq(r.agentWallet,      agent);
        assertEq(r.agentId,          AGENT_ID);
        assertEq(r.txHash,           TX_HASH);
        assertEq(r.evidenceHash,     EV_HASH);
        assertEq(uint8(r.receiptType), uint8(ReceiptType.FINANCING));
        assertEq(uint8(r.verState),    uint8(VerificationState.AVERIS_VERIFIED));
        assertEq(r.issuer,           issuer);
    }

    function testAuthorizedIssuerAnchorsEmitsEvent() public {
        vm.prank(issuer);
        vm.expectEmit(true, true, false, true);
        emit AgentReceiptRegistry.ReceiptAnchored(
            1, agent, AGENT_ID, TX_HASH, EV_HASH,
            ReceiptType.FINANCING, VerificationState.AVERIS_VERIFIED, issuer
        );
        reg.anchorReceipt(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.FINANCING);
    }

    // ── Section B: Self-reported anchoring ───────────────────────────────────

    function testAgentSelfReportsOwnReceipt() public {
        vm.prank(agent);
        uint256 id = reg.anchorReceipt(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.JOB_PAYMENT);

        assertEq(uint8(reg.verificationState(id)), uint8(VerificationState.SELF_REPORTED));
        assertEq(reg.getReceipt(id).issuer, agent);
    }

    function testAgentCannotAnchorForOtherAgent() public {
        // agent cannot anchor for agent2
        vm.prank(agent);
        vm.expectRevert(AgentReceiptRegistry.Unauthorized.selector);
        reg.anchorReceipt(agent2, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.JOB_PAYMENT);
    }

    function testUnauthorizedCallerCannotAnchorForAnyAgent() public {
        vm.prank(nobody);
        vm.expectRevert(AgentReceiptRegistry.Unauthorized.selector);
        reg.anchorReceipt(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.JOB_PAYMENT);
    }

    // ── Section C: External attester ─────────────────────────────────────────

    function testExternalAttesterAnchorsAsExternalAttester() public {
        vm.prank(issuer);
        uint256 id = reg.anchorExternalAttestation(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.API_PURCHASE);
        assertEq(uint8(reg.verificationState(id)), uint8(VerificationState.EXTERNAL_ATTESTER));
    }

    function testNonIssuerCannotAnchorExternal() public {
        vm.prank(nobody);
        vm.expectRevert(AgentReceiptRegistry.Unauthorized.selector);
        reg.anchorExternalAttestation(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.API_PURCHASE);
    }

    // ── Section D: Append-only immutability ───────────────────────────────────

    function testReceiptsAreImmutableAfterAnchoring() public {
        vm.prank(issuer);
        uint256 id = reg.anchorReceipt(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.FINANCING);

        // No function exists to modify a receipt — read it again and verify unchanged
        AgentReceiptRegistry.ReceiptAnchor memory r1 = reg.getReceipt(id);
        AgentReceiptRegistry.ReceiptAnchor memory r2 = reg.getReceipt(id);
        assertEq(r1.evidenceHash, r2.evidenceHash);
        assertEq(r1.anchoredAt,   r2.anchoredAt);
    }

    function testReceiptCountGrowsAppendOnly() public {
        vm.prank(issuer);
        reg.anchorReceipt(agent,  AGENT_ID, TX_HASH, EV_HASH, ReceiptType.FINANCING);
        vm.prank(issuer);
        reg.anchorReceipt(agent,  AGENT_ID, TX_HASH, EV_HASH, ReceiptType.CREDIT_REPAYMENT);
        vm.prank(agent2);
        reg.anchorReceipt(agent2, 0,        TX_HASH, EV_HASH, ReceiptType.JOB_PAYMENT);

        assertEq(reg.totalReceipts(), 3);
        assertEq(reg.getReceiptCount(agent),  2);
        assertEq(reg.getReceiptCount(agent2), 1);
    }

    function testGetAgentReceiptsReturnsAllIds() public {
        vm.prank(issuer);
        reg.anchorReceipt(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.FINANCING);
        vm.prank(issuer);
        reg.anchorReceipt(agent, AGENT_ID, TX_HASH, keccak256("receipt2"), ReceiptType.CREDIT_REPAYMENT);

        uint256[] memory ids = reg.getAgentReceipts(agent);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    // ── Section E: Input validation ───────────────────────────────────────────

    function testZeroEvidenceHashReverts() public {
        vm.prank(issuer);
        vm.expectRevert(AgentReceiptRegistry.ZeroHash.selector);
        reg.anchorReceipt(agent, AGENT_ID, TX_HASH, bytes32(0), ReceiptType.FINANCING);
    }

    function testZeroAgentWalletReverts() public {
        vm.prank(issuer);
        vm.expectRevert(AgentReceiptRegistry.ZeroAddress.selector);
        reg.anchorReceipt(address(0), AGENT_ID, TX_HASH, EV_HASH, ReceiptType.FINANCING);
    }

    function testGetNonExistentReceiptReverts() public {
        vm.expectRevert(AgentReceiptRegistry.ReceiptNotFound.selector);
        reg.getReceipt(999);
    }

    function testVerificationStateNonExistentReverts() public {
        vm.expectRevert(AgentReceiptRegistry.ReceiptNotFound.selector);
        reg.verificationState(999);
    }

    // ── Section F: Issuer authorization management ───────────────────────────

    function testOnlyOwnerCanSetIssuer() public {
        vm.prank(nobody);
        vm.expectRevert(AgentReceiptRegistry.Unauthorized.selector);
        reg.setAuthorizedIssuer(nobody, true);
    }

    function testRevokeIssuerPreventsAnchoring() public {
        reg.setAuthorizedIssuer(issuer, false);

        vm.prank(issuer);
        vm.expectRevert(AgentReceiptRegistry.Unauthorized.selector);
        reg.anchorReceipt(agent, AGENT_ID, TX_HASH, EV_HASH, ReceiptType.FINANCING);
    }

    function testIssuerAuthorizationEmitsEvents() public {
        address newIssuer = address(0x9999);

        vm.expectEmit(true, false, false, false);
        emit AgentReceiptRegistry.IssuerAuthorized(newIssuer);
        reg.setAuthorizedIssuer(newIssuer, true);

        vm.expectEmit(true, false, false, false);
        emit AgentReceiptRegistry.IssuerRevoked(newIssuer);
        reg.setAuthorizedIssuer(newIssuer, false);
    }

    function testOwnershipTransfer() public {
        address newOwner = address(0xBEEF);
        reg.transferOwnership(newOwner);
        assertEq(reg.owner(), newOwner);

        // Original owner can no longer set issuers
        vm.expectRevert(AgentReceiptRegistry.Unauthorized.selector);
        reg.setAuthorizedIssuer(issuer, false);
    }

    function testTransferOwnershipToZeroReverts() public {
        vm.expectRevert(AgentReceiptRegistry.ZeroAddress.selector);
        reg.transferOwnership(address(0));
    }

    // ── Section G: Receipt type coverage ─────────────────────────────────────

    function testAllReceiptTypesAnchorCorrectly() public {
        ReceiptType[10] memory types = [
            ReceiptType.JOB_PAYMENT,
            ReceiptType.FINANCING,
            ReceiptType.CREDIT_REPAYMENT,
            ReceiptType.ESCROW,
            ReceiptType.REFUND,
            ReceiptType.API_PURCHASE,
            ReceiptType.COMPUTE_PURCHASE,
            ReceiptType.AGENT_PAYMENT,
            ReceiptType.TRADING,
            ReceiptType.OTHER
        ];

        for (uint256 i = 0; i < types.length; i++) {
            vm.prank(issuer);
            uint256 id = reg.anchorReceipt(agent, AGENT_ID, TX_HASH, keccak256(abi.encode(i)), types[i]);
            assertEq(uint8(reg.getReceipt(id).receiptType), uint8(types[i]));
        }
    }
}
