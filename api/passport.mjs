/**
 * Passport service layer.
 *
 * Combines:
 *   - Onchain: ERC-8004 identity (via chain adapters), policy registry reads, receipt registry reads
 *   - Offchain: capabilities, transactions, counterparties, agreements, receipt metadata (from passport-store)
 *   - Averis Bank: credit, positions, financing history (from existing server.mjs data)
 *
 * Separation of concerns:
 *   Authoritative onchain data → chain adapters + contract reads
 *   Rich/derived data         → passport-store.mjs
 *   Averis Bank integration   → read-only from existing Averis contracts
 */

import { createPublicClient, http, parseAbi } from "viem";
import { getAllAdapters, ERC8004_TESTNET } from "./chain-adapters/index.mjs";
import * as store from "./passport-store.mjs";

// ── Passport contract ABIs ─────────────────────────────────────────────────────

const POLICY_REGISTRY_ABI = parseAbi([
  "function getAgentPolicies(address agentWallet) external view returns (uint256[])",
  "function getPolicy(uint256 policyId) view returns (uint256 policyId, uint256 version, address agentWallet, uint256 agentId, address identityRegistry, bytes32 policyHash, bytes32 contentURI, uint64 createdAt, uint64 updatedAt, uint64 expiresAt, bool revoked)",
  "function nonces(address agentWallet) view returns (uint256)",
]);

const RECEIPT_REGISTRY_ABI = parseAbi([
  "function getAgentReceipts(address agentWallet) view returns (uint256[])",
  "function getReceipt(uint256 receiptId) view returns (uint256 receiptId, address agentWallet, uint256 agentId, bytes32 txHash, bytes32 evidenceHash, uint8 receiptType, uint64 anchoredAt, address issuer, uint8 verificationState)",
  "function getReceiptCount(address agentWallet) view returns (uint256)",
]);

const IDENTITY_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

// ── Primary chain (RH Testnet — where passport contracts deploy first) ─────────

const RH_RPC = process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
const RH_CHAIN = { id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RH_RPC] } } };
let _rhClient = null;
function getRhClient() {
  if (!_rhClient) _rhClient = createPublicClient({ chain: RH_CHAIN, transport: http(RH_RPC) });
  return _rhClient;
}

// ── Averis Bank (Arc Testnet) ──────────────────────────────────────────────────

const ARC_RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";
const ARC_CHAIN = { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [ARC_RPC] } } };
let _arcClient = null;
function getArcClient() {
  if (!_arcClient) _arcClient = createPublicClient({ chain: ARC_CHAIN, transport: http(ARC_RPC) });
  return _arcClient;
}

const FINANCING_ABI = parseAbi([
  "function creditLimits(address agent) view returns (uint128)",
  "function advanceRateBps() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function protocolMaximum() view returns (uint256)",
]);
const HOOD_ABI = parseAbi([
  "function agentExposure(address agent) view returns (uint128)",
  "function maxExposurePerAgent() view returns (uint128)",
  "function paused() view returns (bool)",
]);
const VAULT_ABI = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
]);

async function readArc(address, abi, fn, args = []) {
  return getArcClient().readContract({ address, abi, functionName: fn, args });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function receiptTypeName(n) {
  return ["JOB_PAYMENT","FINANCING","CREDIT_REPAYMENT","ESCROW","REFUND","API_PURCHASE",
          "COMPUTE_PURCHASE","AGENT_TO_AGENT","TRADING","OTHER"][n] ?? "OTHER";
}

function verificationStateName(n) {
  return ["SELF_REPORTED","AVERIS_VERIFIED","EXTERNAL_ATTESTER"][n] ?? "SELF_REPORTED";
}

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * Resolve all ERC-8004 identities for a wallet across all chains.
 * Uses stored identity links + live chain adapter reads.
 */
export async function getIdentity(wallet) {
  const normalWallet = wallet.toLowerCase();
  const links = store.getIdentityLinks(wallet);
  const adapters = getAllAdapters();

  // For any adapter without a stored link, scan onchain via ERC-721 Transfer events (mints = from 0x0)
  await Promise.all(adapters.map(async adapter => {
    if (links.find(l => l.caip2 === adapter.caip2)) return; // already stored
    try {
      const registryAddr = adapter.identityRegistry;
      if (!registryAddr) return;
      let client;
      if (adapter.caip2 === "eip155:5042002") client = getArcClient();
      else if (adapter.caip2 === "eip155:46630") client = getRhClient();
      else return;
      const latest = await client.getBlockNumber();
      const from = latest > 500000n ? latest - 500000n : 0n;
      // ERC-721 Transfer: from=0x0 (mint), to=wallet, tokenId=agentId
      const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const walletPadded = "0x000000000000000000000000" + wallet.toLowerCase().slice(2);
      const rpc = adapter.caip2 === "eip155:5042002"
        ? (process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io")
        : (process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com");
      const resp = await fetch(rpc, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{
          address: registryAddr,
          topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", ZERO, walletPadded],
          fromBlock: "0x" + from.toString(16),
          toBlock: "latest",
        }]}),
      }).then(r => r.json()).catch(() => ({ result: [] }));
      for (const log of (resp.result || [])) {
        const agentId = parseInt(log.topics[3], 16);
        if (!links.find(l => l.caip2 === adapter.caip2 && l.agentId === agentId)) {
          store.addIdentityLink(wallet, { agentId, caip2: adapter.caip2 });
          links.push({ agentId, caip2: adapter.caip2 });
        }
      }
    } catch { /* silent fallback */ }
  }));

  // Resolve each stored link via live chain adapter
  const resolvedLinks = await Promise.all(
    adapters.map(async adapter => {
      // Check if we have a stored agentId for this chain
      const stored = links.find(l => l.caip2 === adapter.caip2);
      if (!stored) return null;
      const live = await adapter.getAgentIdentity(stored.agentId).catch(() => null);
      if (!live) return { ...stored, verified: false };
      // Verify wallet ownership
      return {
        ...live,
        verified: live.wallet?.toLowerCase() === normalWallet,
        agentId: stored.agentId,
      };
    })
  );

  // Special case: Arc Testnet agentId 900958 is Averis's own registration
  // If the wallet matches 0x4bAf1e5E3355f37539f423Ba251Dd7f98fE2Ea56, add it
  const arcLink = resolvedLinks.find(l => l?.caip2 === "eip155:5042002");
  const rhLink  = resolvedLinks.find(l => l?.caip2 === "eip155:46630");

  return {
    wallet,
    identities: resolvedLinks.filter(Boolean),
    primaryIdentity: arcLink ?? rhLink ?? null,
    hasArcIdentity: Boolean(arcLink),
    hasRhIdentity:  Boolean(rhLink),
    erc8004Registries: {
      testnet: ERC8004_TESTNET,
    },
  };
}

// ── Policies (onchain) ─────────────────────────────────────────────────────────

export async function getPolicies(wallet) {
  const policyRegistry = process.env.PASSPORT_POLICY_REGISTRY;
  if (!policyRegistry) return { policies: [], nonce: 0, note: "PASSPORT_POLICY_REGISTRY not set — Passport contracts not yet deployed" };

  try {
    const client = getRhClient();
    const policyIds = await client.readContract({
      address: policyRegistry,
      abi: POLICY_REGISTRY_ABI,
      functionName: "getAgentPolicies",
      args: [wallet],
    });
    const nonce = await client.readContract({
      address: policyRegistry,
      abi: POLICY_REGISTRY_ABI,
      functionName: "nonces",
      args: [wallet],
    });

    const policiesRaw = await Promise.all(
      policyIds.map(id => client.readContract({
        address: policyRegistry,
        abi: POLICY_REGISTRY_ABI,
        functionName: "getPolicy",
        args: [id],
      }))
    );

    // viem returns named-tuple fields when using parseAbi with named params
    const policies = policiesRaw.map(p => {
      // Handle both array-style and named-style returns
      const policyId   = p.policyId   ?? p[0];
      const version    = p.version    ?? p[1];
      const agentWallet = p.agentWallet ?? p[2];
      const agentId    = p.agentId    ?? p[3];
      const identityRegistry = p.identityRegistry ?? p[4];
      const policyHash = p.policyHash ?? p[5];
      const contentURI = p.contentURI ?? p[6];
      const createdAt  = p.createdAt  ?? p[7];
      const updatedAt  = p.updatedAt  ?? p[8];
      const expiresAt  = p.expiresAt  ?? p[9];
      const revoked    = p.revoked    ?? p[10];
      const now = BigInt(Math.floor(Date.now() / 1000));
      return {
        policyId:        policyId ? Number(policyId) : null,
        version:         version ? Number(version) : null,
        agentWallet,
        agentId:         agentId ? Number(agentId) : null,
        identityRegistry,
        policyHash,
        contentURIHash:  contentURI,
        createdAt:       createdAt ? Number(createdAt) : null,
        updatedAt:       updatedAt ? Number(updatedAt) : null,
        expiresAt:       expiresAt ? Number(expiresAt) : null,
        revoked:         Boolean(revoked),
        active:          !revoked && (!expiresAt || expiresAt === 0n || expiresAt > now),
      };
    });

    return { policies, nonce: Number(nonce) };
  } catch (err) {
    return { policies: [], nonce: 0, error: err.message, registry: process.env.PASSPORT_POLICY_REGISTRY || 'not set' };
  }
}

// ── Receipts (onchain anchors + offchain metadata) ─────────────────────────────

export async function getReceipts(wallet) {
  const receiptRegistry = process.env.PASSPORT_RECEIPT_REGISTRY;
  const meta = store.getReceiptsMeta(wallet);

  if (!receiptRegistry) {
    return { onchain: [], offchain: meta, note: "PASSPORT_RECEIPT_REGISTRY not set" };
  }

  try {
    const client = getRhClient();
    let receiptIds;
    try {
      receiptIds = await client.readContract({
        address: receiptRegistry,
        abi: RECEIPT_REGISTRY_ABI,
        functionName: "getAgentReceipts",
        args: [wallet],
      });
    } catch {
      return { onchain: [], offchain: meta, note: "Receipt registry not yet deployed or unreachable on Robinhood Chain Testnet" };
    }

    const onchain = await Promise.all(
      receiptIds.map(id => client.readContract({
        address: receiptRegistry,
        abi: RECEIPT_REGISTRY_ABI,
        functionName: "getReceipt",
        args: [id],
      }))
    );

    const receipts = onchain.map(r => {
      // Handle both named and positional returns
      const receiptId        = r.receiptId        ?? r[0];
      const agentWallet      = r.agentWallet      ?? r[1];
      const agentId          = r.agentId          ?? r[2];
      const txHash           = r.txHash           ?? r[3];
      const evidenceHash     = r.evidenceHash     ?? r[4];
      const receiptType      = r.receiptType      ?? r[5];
      const anchoredAt       = r.anchoredAt       ?? r[6];
      const issuer           = r.issuer           ?? r[7];
      const verificationStateVal = r.verificationState ?? r[8];
      return {
        receiptId:         receiptId ? Number(receiptId) : null,
        agentWallet,
        agentId:           agentId ? Number(agentId) : null,
        txHash,
        evidenceHash,
        receiptType:       receiptTypeName(Number(receiptType ?? 0)),
        anchoredAt:        anchoredAt ? Number(anchoredAt) : null,
        issuer,
        verificationState: verificationStateName(Number(verificationStateVal ?? 0)),
        meta: meta.find(m => m.receiptId === Number(receiptId)) ?? null,
      };
    });

    return { onchain: receipts, offchain: meta };
  } catch (err) {
    return { onchain: [], offchain: meta, error: err.message };
  }
}

// ── Averis Bank integration ────────────────────────────────────────────────────

export async function getAverisData(wallet) {
  const financing = process.env.AVERIS_FINANCING;
  const hood      = process.env.AVERIS_HOOD;
  const vault     = process.env.AVERIS_VAULT;

  if (!financing || !hood || !vault) {
    return { available: false, note: "Averis contracts not configured" };
  }

  try {
    // creditLimits reverts for addresses that have never interacted with the
    // financing contract — treat a revert as 0 (no custom limit set)
    const creditLimitSafe = readArc(financing, FINANCING_ABI, "creditLimits", [wallet])
      .catch(() => 0n);

    const [creditLimit, exposure, maxPerAgent, paused, totalAssets, available, advanceRate, feeBps, protoMax] =
      await Promise.all([
        creditLimitSafe,
        readArc(hood,      HOOD_ABI,      "agentExposure", [wallet]),
        readArc(hood,      HOOD_ABI,      "maxExposurePerAgent"),
        readArc(hood,      HOOD_ABI,      "paused"),
        readArc(vault,     VAULT_ABI,     "totalAssets"),
        readArc(vault,     VAULT_ABI,     "availableLiquidity"),
        readArc(financing, FINANCING_ABI, "advanceRateBps"),
        readArc(financing, FINANCING_ABI, "feeBps"),
        readArc(financing, FINANCING_ABI, "protocolMaximum"),
      ]);

    const creditLimitNum  = Number(creditLimit);
    const exposureNum     = Number(exposure);
    const maxPerAgentNum  = Number(maxPerAgent);
    const effectiveCap    = creditLimitNum > 0 ? creditLimitNum : Number(protoMax);
    const availableCredit = Math.max(0, effectiveCap - exposureNum);

    // Risk tier: simple evidence-based bucketing (not a score — extensible)
    let riskTier = "UNRATED";
    if (exposureNum === 0 && creditLimitNum === 0) riskTier = "UNRATED";
    else if (exposureNum === 0) riskTier = "ELIGIBLE";
    else if (exposureNum < effectiveCap * 0.5) riskTier = "ACTIVE";
    else if (exposureNum < effectiveCap) riskTier = "HIGH_UTILIZATION";
    else riskTier = "AT_LIMIT";

    return {
      available: true,
      creditLimit:     creditLimitNum,
      exposure:        exposureNum,
      maxPerAgent:     maxPerAgentNum,
      availableCredit,
      effectiveCap,
      advanceRateBps:  Number(advanceRate),
      feeBps:          Number(feeBps),
      protocolMaximum: Number(protoMax),
      vaultTotalAssets: Number(totalAssets),
      vaultAvailable:  Number(available),
      hoodPaused:      paused,
      riskTier,
      riskFactors: [
        { factor: "Current exposure",     value: exposureNum,    notes: "Outstanding principal across all active jobs" },
        { factor: "Credit limit",         value: creditLimitNum, notes: creditLimitNum > 0 ? "Custom limit set by owner" : "Using protocol maximum" },
        { factor: "Advance rate",         value: `${Number(advanceRate) / 100}%`, notes: "Percentage of job budget available as advance" },
        { factor: "Vault liquidity",      value: Number(available), notes: "Capital available to deploy" },
        { factor: "Hood status",          value: paused ? "PAUSED" : "ACTIVE", notes: "Protocol risk circuit breaker" },
      ],
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

// ── Full economic profile ──────────────────────────────────────────────────────

export async function getEconomicProfile(wallet) {
  const [
    identity,
    policies,
    receipts,
    averisData,
  ] = await Promise.all([
    getIdentity(wallet),
    getPolicies(wallet),
    getReceipts(wallet),
    getAverisData(wallet),
  ]);

  const capabilities   = store.getCapabilities(wallet);
  const transactions   = store.getTransactions(wallet);
  const counterparties = store.getCounterparties(wallet);
  const agreements     = store.getAgreements(wallet);
  const reputation     = store.getReputationEvidence(wallet);

  // Merge Averis financing history into reputation evidence
  if (averisData.available) {
    reputation.averisCredit = {
      creditLimit:     averisData.creditLimit,
      available:       averisData.availableCredit,
      exposure:        averisData.exposure,
      riskTier:        averisData.riskTier,
    };
  }

  return {
    wallet,
    generatedAt: new Date().toISOString(),
    identity,
    capabilities,
    policies,
    receipts,
    reputation,
    transactions,
    counterparties,
    agreements,
    averisBank: averisData,
    // Summary for Passport Overview panel
    summary: {
      hasIdentity:         Boolean(identity.primaryIdentity),
      identityCount:       identity.identities.length,
      capabilityCount:     capabilities.length,
      policyCount:         policies.policies?.length ?? 0,
      receiptCount:        receipts.onchain?.length ?? 0,
      transactionCount:    transactions.total,
      counterpartyCount:   counterparties.length,
      agreementCount:      agreements.length,
      riskTier:            averisData.available ? averisData.riskTier : "UNRATED",
      availableCredit:     averisData.available ? averisData.availableCredit : null,
      exposure:            averisData.available ? averisData.exposure : null,
    },
  };
}
