/**
 * MCP Passport Tools — 10 tools for autonomous agent access to the Economic Passport.
 * Integrated into the existing MCP server via handleMCPPassport().
 */

import * as passport from "./passport.mjs";
import * as store    from "./passport-store.mjs";

export const MCP_PASSPORT_TOOLS = [
  {
    name: "get_agent_passport",
    description: "Get the complete Agent Economic Passport for a wallet address. Returns identity, capabilities, policies, reputation evidence, risk tier, and Averis Bank integration.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string", description: "Agent wallet address (0x...)" } },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_identity",
    description: "Resolve ERC-8004 identity for an agent across all supported chains (Robinhood Chain Testnet, Arc Testnet). Returns agentId, wallet, metadataURI, and verification status per chain.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string", description: "Agent wallet address (0x...)" } },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_capabilities",
    description: "Get declared capabilities for an agent (research, coding, payments, DeFi, etc.). Capabilities are self-declared and can reference attestation evidence.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string" } },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_policies",
    description: "Get onchain EIP-712 policy commitments for an agent from AgentPolicyRegistry (Robinhood Chain Testnet). Includes version, expiry, revocation status, and policy hashes.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string" } },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_reputation",
    description: "Get evidence-based reputation for an agent: jobs completed/failed/disputed, payments, financing repaid, outstanding obligations, counterparties, receipts. Not a score — raw evidence.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string" } },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_risk",
    description: "Get risk profile for an agent from Averis Bank: risk tier (UNRATED/ELIGIBLE/ACTIVE/HIGH_UTILIZATION/AT_LIMIT), credit capacity, exposure, and contributing risk factors.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string" } },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_transactions",
    description: "Get economic transaction history for an agent. Supports filtering by type, status, counterparty. Types: JOB_PAYMENT, FINANCING, CREDIT_REPAYMENT, ESCROW, REFUND, API_PURCHASE, COMPUTE_PURCHASE, AGENT_TO_AGENT, TRADING, OTHER.",
    inputSchema: {
      type: "object",
      properties: {
        agentAddress:  { type: "string" },
        type:          { type: "string", description: "Filter by transaction type" },
        status:        { type: "string", description: "Filter by status (active/completed/failed/disputed)" },
        counterparty:  { type: "string", description: "Filter by counterparty address" },
        limit:         { type: "number", default: 50 },
        offset:        { type: "number", default: 0 },
      },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_counterparties",
    description: "Get counterparty graph for an agent: agents/services they have transacted with, interaction count, volume, disputes, and relationship status.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string" } },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_receipts",
    description: "Get verifiable economic receipts for an agent from AgentReceiptRegistry (onchain anchors) merged with offchain metadata. Verification states: SELF_REPORTED, AVERIS_VERIFIED, EXTERNAL_ATTESTER.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string" } },
      required: ["agentAddress"],
    },
  },
  {
    name: "get_agent_credit_capacity",
    description: "Get current Averis credit capacity for an agent: available credit, exposure, credit limit, risk tier, advance rate, and vault liquidity. Combines Averis Bank data with Passport identity.",
    inputSchema: {
      type: "object",
      properties: { agentAddress: { type: "string" } },
      required: ["agentAddress"],
    },
  },
];

export async function handleMCPPassport(method, params) {
  const addr = params?.agentAddress;
  if (!addr) return { error: "agentAddress required" };

  switch (method) {
    case "get_agent_passport":
      return passport.getEconomicProfile(addr);

    case "get_agent_identity":
      return passport.getIdentity(addr);

    case "get_agent_capabilities":
      return { agentAddress: addr, capabilities: store.getCapabilities(addr) };

    case "get_agent_policies":
      return passport.getPolicies(addr);

    case "get_agent_reputation":
      return {
        agentAddress: addr,
        evidence: store.getReputationEvidence(addr),
        note: "Evidence-based reputation. Not a score. Extensible.",
      };

    case "get_agent_risk":
      return passport.getAverisData(addr);

    case "get_agent_transactions":
      return store.getTransactions(addr, {
        type:        params.type,
        status:      params.status,
        counterparty: params.counterparty,
        limit:       params.limit ?? 50,
        offset:      params.offset ?? 0,
      });

    case "get_agent_counterparties":
      return { agentAddress: addr, counterparties: store.getCounterparties(addr) };

    case "get_agent_receipts":
      return passport.getReceipts(addr);

    case "get_agent_credit_capacity": {
      const [risk, identity] = await Promise.all([
        passport.getAverisData(addr),
        passport.getIdentity(addr),
      ]);
      return {
        agentAddress: addr,
        identity:     identity.primaryIdentity,
        credit:       risk,
      };
    }

    default:
      return null; // Not a passport tool
  }
}
