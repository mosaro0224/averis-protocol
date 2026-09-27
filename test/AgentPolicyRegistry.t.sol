// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/passport/AgentPolicyRegistry.sol";
import "../src/interfaces/IAgentPassport.sol";

contract AgentPolicyRegistryTest is Test {

    AgentPolicyRegistry public reg;

    // Test accounts
    uint256 internal agentPk  = 0xA11CE;
    uint256 internal agent2Pk = 0xB0B;
    address internal agent;
    address internal agent2;
    address internal nobody = address(0xDEAD);

    // Sample policy data
    bytes32 constant POLICY_HASH   = keccak256("policy-json-v1");
    bytes32 constant CONTENT_URI   = keccak256("ipfs://bafkrei...");
    address constant IDENTITY_REG  = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    uint256 constant AGENT_ID      = 42;
    uint64  constant NO_EXPIRY     = 0;

    function setUp() public {
        reg    = new AgentPolicyRegistry();
        agent  = vm.addr(agentPk);
        agent2 = vm.addr(agent2Pk);
    }

    // ── Section A: Direct commit (msg.sender) ─────────────────────────────────

    function testDirectCommitStoresPolicy() public {
        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);

        AgentPolicyRegistry.Policy memory p = reg.getPolicy(id);
        assertEq(p.policyId,         id);
        assertEq(p.version,          1);
        assertEq(p.agentWallet,      agent);
        assertEq(p.policyHash,       POLICY_HASH);
        assertEq(p.contentURI,       CONTENT_URI);
        assertEq(p.agentId,          AGENT_ID);
        assertEq(p.identityRegistry, IDENTITY_REG);
        assertEq(p.expiresAt,        NO_EXPIRY);
        assertFalse(p.revoked);
    }

    function testDirectCommitEmitsEvent() public {
        vm.prank(agent);
        vm.expectEmit(true, true, false, true);
        emit AgentPolicyRegistry.PolicyCommitted(agent, 1, 1, POLICY_HASH, CONTENT_URI, AGENT_ID, IDENTITY_REG, NO_EXPIRY);
        reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);
    }

    function testDirectCommitIncrementsGlobalCounter() public {
        vm.prank(agent);
        reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);
        assertEq(reg.totalPolicies(), 1);

        vm.prank(agent2);
        reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, 0, address(0));
        assertEq(reg.totalPolicies(), 2);
    }

    function testDirectCommitZeroHashReverts() public {
        vm.prank(agent);
        vm.expectRevert(AgentPolicyRegistry.InvalidPolicyHash.selector);
        reg.commitPolicy(bytes32(0), CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);
    }

    function testGetAgentPoliciesReturnsList() public {
        vm.startPrank(agent);
        reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);
        reg.commitPolicy(keccak256("policy-v2"), CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);
        vm.stopPrank();

        uint256[] memory ids = reg.getAgentPolicies(agent);
        assertEq(ids.length, 2);
    }

    // ── Section B: EIP-712 signed commit ─────────────────────────────────────

    function _buildPolicyDigest(
        address  agentWallet,
        uint256  agentId,
        address  identityRegistry,
        bytes32  policyHash,
        bytes32  contentURI,
        uint64   expiresAt,
        uint256  nonce,
        uint256  deadline
    ) internal view returns (bytes32) {
        bytes32 domSep = reg.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(abi.encode(
            reg.POLICY_TYPEHASH(),
            agentWallet, agentId, identityRegistry,
            policyHash, contentURI, expiresAt, nonce, deadline
        ));
        return keccak256(abi.encodePacked("\x19\x01", domSep, structHash));
    }

    function testSignedCommitValidSignature() public {
        uint256 nonce    = 0;
        uint256 deadline = block.timestamp + 3600;

        bytes32 digest = _buildPolicyDigest(agent, AGENT_ID, IDENTITY_REG, POLICY_HASH, CONTENT_URI, NO_EXPIRY, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 id = reg.commitPolicyFor(agent, POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG, nonce, deadline, sig);

        AgentPolicyRegistry.Policy memory p = reg.getPolicy(id);
        assertEq(p.agentWallet, agent);
        assertEq(p.version, 1);
    }

    function testSignedCommitIncreasesNonce() public {
        uint256 nonce    = 0;
        uint256 deadline = block.timestamp + 3600;

        bytes32 digest = _buildPolicyDigest(agent, AGENT_ID, IDENTITY_REG, POLICY_HASH, CONTENT_URI, NO_EXPIRY, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);

        reg.commitPolicyFor(agent, POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG, nonce, deadline, abi.encodePacked(r, s, v));
        assertEq(reg.nonces(agent), 1);
    }

    function testSignedCommitWrongSignerReverts() public {
        uint256 nonce    = 0;
        uint256 deadline = block.timestamp + 3600;

        bytes32 digest = _buildPolicyDigest(agent, AGENT_ID, IDENTITY_REG, POLICY_HASH, CONTENT_URI, NO_EXPIRY, nonce, deadline);
        // Sign with agent2's key but pass agent's address
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agent2Pk, digest);

        vm.expectRevert(AgentPolicyRegistry.InvalidSignature.selector);
        reg.commitPolicyFor(agent, POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG, nonce, deadline, abi.encodePacked(r, s, v));
    }

    function testSignedCommitNonceReplayReverts() public {
        uint256 nonce    = 0;
        uint256 deadline = block.timestamp + 3600;

        bytes32 digest = _buildPolicyDigest(agent, AGENT_ID, IDENTITY_REG, POLICY_HASH, CONTENT_URI, NO_EXPIRY, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // First call succeeds
        reg.commitPolicyFor(agent, POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG, nonce, deadline, sig);

        // Second call with same nonce reverts
        vm.expectRevert(AgentPolicyRegistry.NonceReused.selector);
        reg.commitPolicyFor(agent, POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG, nonce, deadline, sig);
    }

    function testSignedCommitExpiredDeadlineReverts() public {
        uint256 nonce    = 0;
        uint256 deadline = block.timestamp - 1; // already expired

        bytes32 digest = _buildPolicyDigest(agent, AGENT_ID, IDENTITY_REG, POLICY_HASH, CONTENT_URI, NO_EXPIRY, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentPk, digest);

        vm.expectRevert(AgentPolicyRegistry.DeadlineExpired.selector);
        reg.commitPolicyFor(agent, POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG, nonce, deadline, abi.encodePacked(r, s, v));
    }

    function testDomainSeparatorIncludesContract() public view {
        // Domain separator must include this contract's address — domain separation from AverisProtocol v2
        bytes32 expected = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("AverisPassport"),
            keccak256("1"),
            block.chainid,
            address(reg)
        ));
        assertEq(reg.DOMAIN_SEPARATOR(), expected);
    }

    // ── Section C: Revocation ─────────────────────────────────────────────────

    function testRevokeByOwner() public {
        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);

        vm.prank(agent);
        vm.expectEmit(true, true, false, false);
        emit AgentPolicyRegistry.PolicyRevoked(agent, id);
        reg.revokePolicy(id);

        AgentPolicyRegistry.Policy memory p = reg.getPolicy(id);
        assertTrue(p.revoked);
    }

    function testRevokeByNonOwnerReverts() public {
        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);

        vm.prank(nobody);
        vm.expectRevert(AgentPolicyRegistry.Unauthorized.selector);
        reg.revokePolicy(id);
    }

    function testRevokeAlreadyRevokedReverts() public {
        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);

        vm.prank(agent);
        reg.revokePolicy(id);

        vm.prank(agent);
        vm.expectRevert(AgentPolicyRegistry.PolicyAlreadyRevoked.selector);
        reg.revokePolicy(id);
    }

    function testIsPolicyValidReturnsFalseAfterRevoke() public {
        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);
        assertTrue(reg.isPolicyValid(id));

        vm.prank(agent);
        reg.revokePolicy(id);
        assertFalse(reg.isPolicyValid(id));
    }

    function testIsPolicyValidReturnsFalseAfterExpiry() public {
        uint64 expiresAt = uint64(block.timestamp + 100);

        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, expiresAt, AGENT_ID, IDENTITY_REG);
        assertTrue(reg.isPolicyValid(id));

        vm.warp(block.timestamp + 200);
        assertFalse(reg.isPolicyValid(id));
    }

    // ── Section D: Policy ownership transfer ─────────────────────────────────

    function testTransferPolicyOwner() public {
        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);

        vm.prank(agent);
        vm.expectEmit(true, true, true, false);
        emit AgentPolicyRegistry.PolicyOwnerTransferred(id, agent, agent2);
        reg.transferPolicyOwner(id, agent2);

        AgentPolicyRegistry.Policy memory p = reg.getPolicy(id);
        assertEq(p.agentWallet, agent2);

        // agent2's policy list should include it
        uint256[] memory agent2Policies = reg.getAgentPolicies(agent2);
        assertEq(agent2Policies[agent2Policies.length - 1], id);
    }

    function testTransferByNonOwnerReverts() public {
        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);

        vm.prank(nobody);
        vm.expectRevert(AgentPolicyRegistry.Unauthorized.selector);
        reg.transferPolicyOwner(id, nobody);
    }

    function testTransferToZeroAddressReverts() public {
        vm.prank(agent);
        uint256 id = reg.commitPolicy(POLICY_HASH, CONTENT_URI, NO_EXPIRY, AGENT_ID, IDENTITY_REG);

        vm.prank(agent);
        vm.expectRevert(AgentPolicyRegistry.ZeroAddress.selector);
        reg.transferPolicyOwner(id, address(0));
    }

    // ── Section E: Cross-chain identity linking ───────────────────────────────

    function testLinkIdentityStoresAndEmits() public {
        vm.prank(agent);
        vm.expectEmit(true, false, false, true);
        emit AgentPolicyRegistry.IdentityLinked(agent, 5042002, IDENTITY_REG, 900958);
        reg.linkIdentity(5042002, IDENTITY_REG, 900958);

        AgentPolicyRegistry.IdentityLink[] memory links = reg.getAgentIdentityLinks(agent);
        assertEq(links.length, 1);
        assertEq(links[0].chainId,         5042002);
        assertEq(links[0].registryAddress, IDENTITY_REG);
        assertEq(links[0].agentId,         900958);
        assertEq(links[0].wallet,          agent);
    }

    function testMultipleIdentityLinks() public {
        vm.startPrank(agent);
        reg.linkIdentity(5042002,  IDENTITY_REG, 900958);  // Arc Testnet
        reg.linkIdentity(46630,    IDENTITY_REG, 42);       // RH Testnet
        vm.stopPrank();

        AgentPolicyRegistry.IdentityLink[] memory links = reg.getAgentIdentityLinks(agent);
        assertEq(links.length, 2);
        assertEq(links[0].chainId, 5042002);
        assertEq(links[1].chainId, 46630);
    }
}
