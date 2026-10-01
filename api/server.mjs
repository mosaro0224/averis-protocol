/**
 * Averis Protocol V2 — API Server
 *
 * Real implementation replacing the V1 stub.
 * Reads on-chain state via viem (no transaction signing — read-only RPC).
 * Mutating flows return unsigned calldata; the agent submits the transaction.
 *
 * Authentication: every agent-facing mutating request requires
 *   X-Agent-Signature: <EIP-712 signature over {agentAddress, nonce, expiry, chainId}>
 *
 * The server verifies ecrecover(hash, sig) == agentAddress,
 * then confirms agentAddress == job.provider on-chain before proceeding.
 */

import express from "express";
import { createPublicClient, http, recoverTypedDataAddress, parseAbi, keccak256, encodePacked } from "viem";
import { createRequire } from "module";
import { handleMCP, MCP_TOOLS } from "./mcp.mjs";
import { handleMCPPassport, MCP_PASSPORT_TOOLS } from "./mcp-passport.mjs";
import * as passportService from "./passport.mjs";
import * as passportStore   from "./passport-store.mjs";

const _require = createRequire(import.meta.url);
const AGENT_CARD = _require("./agent-card.json");
const OPENAPI    = _require("./openapi.json");

const app  = express();
app.use(express.json());

// ── Global CORS — allow all origins (public read-only API) ─────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Agent-Signature, Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ── Chain / RPC configuration ──────────────────────────────────────────────

const ARC_CHAIN_ID    = Number(process.env.ARC_CHAIN_ID || 5042002);
const ARC_RPC_URL     = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";
const PORT            = Number(process.env.PORT || 3001);

const arcChain = {
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
};

const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC_URL),
});

// ── Contract addresses (read from env, set after deployment) ───────────────

const CONTRACTS = {
  vault:           process.env.AVERIS_VAULT           || null,
  financing:       process.env.AVERIS_FINANCING       || null,
  acp:             process.env.AVERIS_ACP             || null,
  router:          process.env.AVERIS_ROUTER          || null,
  hood:            process.env.AVERIS_HOOD            || null,
  factory:         process.env.AVERIS_FACTORY         || null,
  registry:        process.env.AVERIS_REGISTRY        || null,
  credit:          process.env.AVERIS_CREDIT          || null,
  externalAdapter: process.env.AVERIS_EXTERNAL_ADAPTER || "0xbd07EBa80Bf4b6F6999A6951Af05beC11BC833bb",
};

const contractsDeployed = () => Object.values(CONTRACTS).every(Boolean);

// ── Minimal ABIs for on-chain reads ───────────────────────────────────────

const VAULT_ABI = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function outstandingPrincipal() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

const FINANCING_ABI = parseAbi([
  "function getPosition(uint256 jobId) view returns (address agent, address poolAddress, uint128 principal, uint128 fee, uint128 principalRepaid, uint128 feeRepaid, uint64 expiry, uint8 status, uint8 tier, uint8 repayMode)",
  "function maxAdvance(address protocol, uint256 jobId, uint256 amount) view returns (uint256)",
  "function creditLimits(address agent) view returns (uint128)",
  "function advanceRateBps() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function protocolMaximum() view returns (uint256)",
  "function obligationNonces(address agent) view returns (uint256)",
]);

const ACP_ABI = parseAbi([
  "function getJob(uint256 jobId) view returns (address client, address provider, address evaluator, address payoutReceiver, address token, uint128 budget, uint128 settledAmount, uint64 expiry, uint8 status)",
]);

const HOOD_ABI = parseAbi([
  "function paused() view returns (bool)",
  "function agentExposure(address agent) view returns (uint128)",
  "function maxExposurePerAgent() view returns (uint128)",
  "function maxExposureTotal() view returns (uint128)",
  "function maxJobsPerAgent() view returns (uint8)",
  "function maxConcentrationBps() view returns (uint16)",
  "function activeJobCount(address agent) view returns (uint8)",
]);

const POOL_ABI = parseAbi([
  "function agent() view returns (address)",
  "function jobId() view returns (uint256)",
  "function approvedAmount() view returns (uint256)",
  "function totalSpent() view returns (uint128)",
  "function expiry() view returns (uint256)",
  "function frozen() view returns (bool)",
  "function perTxLimit() view returns (uint128)",
  "function allowedRecipientsLength() view returns (uint256)",
  "function allowedRecipients(uint256 i) view returns (address)",
]);

const REGISTRY_ABI = parseAbi([
  "function isActive(address protocol, uint256 adapterId) view returns (bool)",
  "function adapters(address protocol) view returns (address adapter, uint8 tier, bool active)",
]);

// ── EIP-712 domain + types for agent request auth ─────────────────────────

const DOMAIN_NAME    = "AverisProtocol";
const DOMAIN_VERSION = "2";

function buildDomain(chainId) {
  return {
    name:    DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: BigInt(chainId),
  };
}

const AUTH_TYPES = {
  AgentRequest: [
    { name: "agentAddress", type: "address" },
    { name: "nonce",        type: "uint256" },
    { name: "expiry",       type: "uint256" },
    { name: "chainId",      type: "uint256" },
  ],
};

// ── Auth middleware ────────────────────────────────────────────────────────

async function verifyAgentAuth(req, res, next) {
  const sig       = req.headers["x-agent-signature"];
  const agent     = req.body?.agentAddress || req.params?.agent;
  const nonce     = req.body?.nonce;
  const expiry    = req.body?.expiry;

  if (!sig || !agent || nonce === undefined || expiry === undefined) {
    return res.status(401).json({ error: "Missing auth: provide agentAddress, nonce, expiry, and X-Agent-Signature header" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(expiry) < now) {
    return res.status(401).json({ error: "Signature expired" });
  }

  try {
    const recovered = await recoverTypedDataAddress({
      domain: buildDomain(ARC_CHAIN_ID),
      types:  AUTH_TYPES,
      primaryType: "AgentRequest",
      message: {
        agentAddress: agent,
        nonce:        BigInt(nonce),
        expiry:       BigInt(expiry),
        chainId:      BigInt(ARC_CHAIN_ID),
      },
      signature: sig,
    });

    if (recovered.toLowerCase() !== agent.toLowerCase()) {
      return res.status(401).json({ error: "Signature does not match agentAddress" });
    }

    req.verifiedAgent = agent;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid signature", detail: err.message });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function requireContracts(res) {
  if (!contractsDeployed()) {
    res.status(503).json({
      error:   "Contracts not deployed",
      message: "Set AVERIS_VAULT, AVERIS_FINANCING, AVERIS_ACP, AVERIS_ROUTER, AVERIS_HOOD, AVERIS_FACTORY, AVERIS_REGISTRY, AVERIS_CREDIT in environment.",
      contracts: CONTRACTS,
    });
    return false;
  }
  return true;
}

async function readContract(address, abi, functionName, args = []) {
  return publicClient.readContract({ address, abi, functionName, args });
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /health
app.get("/health", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  let chainOk = false;
  let blockNumber = null;
  try {
    blockNumber = Number(await publicClient.getBlockNumber());
    chainOk = true;
  } catch { }

  res.json({
    status:          chainOk ? "ok" : "degraded",
    version:         "2.0.0",
    contracts:       CONTRACTS,
    contractsReady:  contractsDeployed(),
    chain: {
      id:          ARC_CHAIN_ID,
      rpc:         ARC_RPC_URL,
      blockNumber,
      reachable:   chainOk,
    },
    timestamp: new Date().toISOString(),
  });
});

// GET /v2/protocol
// Protocol-wide stats for the capital provider dashboard.
app.get("/v2/protocol", async (req, res) => {
  if (!requireContracts(res)) return;
  try {
    const [totalAssets, available, outstanding, totalSupply, paused,
           maxPerAgent, maxTotal, advanceRate, feeBps, protoMax] = await Promise.all([
      readContract(CONTRACTS.vault, VAULT_ABI, "totalAssets"),
      readContract(CONTRACTS.vault, VAULT_ABI, "availableLiquidity"),
      readContract(CONTRACTS.vault, VAULT_ABI, "outstandingPrincipal"),
      readContract(CONTRACTS.vault, VAULT_ABI, "totalSupply"),
      readContract(CONTRACTS.hood,  HOOD_ABI,  "paused"),
      readContract(CONTRACTS.hood,  HOOD_ABI,  "maxExposurePerAgent"),
      readContract(CONTRACTS.hood,  HOOD_ABI,  "maxExposureTotal"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "advanceRateBps"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "feeBps"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "protocolMaximum"),
    ]);

    const utilization = totalAssets > 0n
      ? Number((outstanding * 10000n) / totalAssets) / 100
      : 0;

    res.json({
      vault: {
        totalAssets:         totalAssets.toString(),
        availableLiquidity:  available.toString(),
        outstandingPrincipal: outstanding.toString(),
        totalShares:         totalSupply.toString(),
        utilizationPct:      utilization,
      },
      hood: {
        paused,
        maxExposurePerAgent: maxPerAgent.toString(),
        maxExposureTotal:    maxTotal.toString(),
      },
      financing: {
        advanceRateBps: advanceRate.toString(),
        feeBps:         feeBps.toString(),
        protocolMaximum: protoMax.toString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v2/agents/verify
// Verify an agent address and return their credit profile.
app.post("/v2/agents/verify", async (req, res) => {
  if (!requireContracts(res)) return;
  const { agentAddress } = req.body;
  if (!agentAddress) return res.status(400).json({ error: "agentAddress required" });

  try {
    const [creditLimit, exposure, _maxPerAgent1, activeJobs, maxJobs] = await Promise.all([
      readContract(CONTRACTS.financing, FINANCING_ABI, "creditLimits", [agentAddress]),
      readContract(CONTRACTS.hood, HOOD_ABI, "agentExposure", [agentAddress]),
      readContract(CONTRACTS.hood, HOOD_ABI, "maxExposurePerAgent"),
      readContract(CONTRACTS.hood, HOOD_ABI, "activeJobCount", [agentAddress]),
      readContract(CONTRACTS.hood, HOOD_ABI, "maxJobsPerAgent"),
    ]);

    const protoMax = await readContract(CONTRACTS.financing, FINANCING_ABI, "protocolMaximum");
    const effectiveLimit = creditLimit > 0n ? creditLimit : protoMax;
    const available = exposure < effectiveLimit ? effectiveLimit - exposure : 0n;

    res.json({
      agentAddress,
      credit: {
        limit:          effectiveLimit.toString(),
        used:           exposure.toString(),
        available:      available.toString(),
        isCustomLimit:  creditLimit > 0n,
      },
      jobs: {
        active: Number(activeJobs),
        maxAllowed: Number(maxJobs),
        slotsAvailable: Math.max(0, Number(maxJobs) - Number(activeJobs)),
      },
      eligible: available > 0n && Number(activeJobs) < Number(maxJobs),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v2/jobs/verify
// Verify a job is eligible for financing.
app.post("/v2/jobs/verify", async (req, res) => {
  if (!requireContracts(res)) return;
  const { protocol, jobId, agentAddress } = req.body;
  if (!protocol || jobId === undefined) return res.status(400).json({ error: "protocol and jobId required" });

  try {
    // Check adapter registration
    const isRegistered = await readContract(CONTRACTS.registry, REGISTRY_ABI, "isActive", [protocol, 0n]).catch(() => false);

    let jobView = null;
    let warnings = [];

    if (protocol.toLowerCase() === CONTRACTS.acp?.toLowerCase()) {
      // Native Averis job — read directly
      const job = await readContract(CONTRACTS.acp, ACP_ABI, "getJob", [BigInt(jobId)]);
      const [client, provider, evaluator, payoutReceiver, token, budget, settledAmount, expiry, status] = job;
      const now = Math.floor(Date.now() / 1000);
      jobView = { client, provider, evaluator, payoutReceiver, token, budget: budget.toString(), settledAmount: settledAmount.toString(), expiry: expiry.toString(), status: Number(status) };

      if (agentAddress && provider.toLowerCase() !== agentAddress.toLowerCase()) warnings.push("Agent is not the job provider");
      if (Number(status) !== 2) warnings.push("Job is not in FUNDED state (status must be 2)");
      if (Number(expiry) < now) warnings.push("Job has expired");
      if (payoutReceiver.toLowerCase() !== CONTRACTS.router?.toLowerCase()) warnings.push("Payout receiver is not set to ReceivableRouter — lien not established");
    } else if (!isRegistered) {
      warnings.push("Protocol not registered in Averis adapter registry — only ATTESTED-tier financing may be available");
    }

    // Compute max advance
    let maxAdvance = "0";
    try {
      const ma = await readContract(CONTRACTS.financing, FINANCING_ABI, "maxAdvance", [protocol, BigInt(jobId), BigInt(req.body.requestedAmount || 0)]);
      maxAdvance = ma.toString();
    } catch { }

    res.json({
      protocol,
      jobId:       jobId.toString(),
      registered:  isRegistered,
      job:         jobView,
      maxAdvance,
      warnings,
      eligible:    warnings.length === 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v2/credit/quote
// Compute financing terms and return a signed EIP-712 quote.
// Does NOT require agent auth — it's a read-only computation.
app.post("/v2/credit/quote", async (req, res) => {
  if (!requireContracts(res)) return;
  const { agentAddress, protocol, jobId, requestedAmount } = req.body;
  if (!agentAddress || !protocol || jobId === undefined || !requestedAmount) {
    return res.status(400).json({ error: "agentAddress, protocol, jobId, requestedAmount required" });
  }

  try {
    const [maxAdvance, feeBps, advanceRate, protocolMax, blockNumber] = await Promise.all([
      readContract(CONTRACTS.financing, FINANCING_ABI, "maxAdvance", [protocol, BigInt(jobId), BigInt(requestedAmount)]),
      readContract(CONTRACTS.financing, FINANCING_ABI, "feeBps"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "advanceRateBps"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "protocolMaximum"),
      publicClient.getBlockNumber(),
    ]);

    const approved  = maxAdvance < BigInt(requestedAmount) ? maxAdvance : BigInt(requestedAmount);
    const fee       = (approved * feeBps) / 10000n;
    const totalOwed = approved + fee;

    // terms_hash: keccak256 of the three owner-adjustable parameters read at quote time.
    // Agents should verify terms_hash hasn't changed before signing draw().
    // If terms change between quote and draw, draw() enforces new terms on-chain.
    const termsHash = keccak256(encodePacked(
      ["uint256", "uint256", "uint256"],
      [advanceRate, feeBps, protocolMax]
    ));

    // quote expires in ~5 minutes (600 blocks at 500ms block time)
    const quoteExpiryBlock = blockNumber + 600n;
    const quotedAt = new Date().toISOString();

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      agentAddress,
      protocol,
      jobId:           jobId.toString(),
      requestedAmount: requestedAmount.toString(),
      quoted_at:       quotedAt,
      quoted_at_block: blockNumber.toString(),
      expires_at_block: quoteExpiryBlock.toString(),
      terms_hash:      termsHash,
      terms_hash_note: "Hash of advanceRateBps + feeBps + protocolMaximum at quote time. If terms change before draw(), this hash changes. Verify on-chain via AverisFinancingV2 before signing.",
      quote: {
        approvedAmount:  approved.toString(),
        fee:             fee.toString(),
        totalRepayment:  totalOwed.toString(),
        feeBps:          feeBps.toString(),
        advanceRateBps:  advanceRate.toString(),
        protocolMaximum: protocolMax.toString(),
        maxAvailable:    maxAdvance.toString(),
      },
      // Agent calls AverisFinancingV2.draw(protocol, jobId, approved, allowedRecipients, perTxLimit)
      // No server-side signing needed — terms are enforced on-chain.
      calldata: {
        contract:  CONTRACTS.financing,
        function:  "draw(address,uint256,uint256,address[],uint128)",
        note:      "Agent must call with their own wallet. allowedRecipients and perTxLimit are agent-specified at draw time.",
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v2/positions/:jobId
// Return position state for a financed job.
app.get("/v2/positions/:jobId", async (req, res) => {
  if (!requireContracts(res)) return;
  try {
    const pos = await readContract(CONTRACTS.financing, FINANCING_ABI, "getPosition", [BigInt(req.params.jobId)]);
    const [agent, poolAddress, principal, fee, principalRepaid, feeRepaid, expiry, status, tier, repayMode] = pos;

    const STATUS_NAMES = ["NONE", "ACTIVE", "REPAID", "DEFAULTED", "EXPIRED", "PARTIALLY_RECOVERED"];
    const MODE_NAMES   = ["LIEN", "OBLIGATION"];

    res.json({
      jobId:          req.params.jobId,
      agent,
      principal:      principal.toString(),
      fee:            fee.toString(),
      principalRepaid: principalRepaid.toString(),
      feeRepaid:      feeRepaid.toString(),
      status:         STATUS_NAMES[Number(status)] || String(status),
      statusCode:     Number(status),
      expiry:         expiry.toString(),
      expiryDate:     new Date(Number(expiry) * 1000).toISOString(),
      poolAddress,
      mode:           MODE_NAMES[Number(repayMode)] || String(repayMode),
      outstanding:    (BigInt(principal) - BigInt(principalRepaid)).toString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v2/pools/:poolAddress
// Return spending pool state.
app.get("/v2/pools/:poolAddress", async (req, res) => {
  const pool = req.params.poolAddress;
  try {
    const [agent, jobId, approvedAmount, totalSpent, expiry, frozen, perTxLimit, recipCount] =
      await Promise.all([
        readContract(pool, POOL_ABI, "agent"),
        readContract(pool, POOL_ABI, "jobId"),
        readContract(pool, POOL_ABI, "approvedAmount"),
        readContract(pool, POOL_ABI, "totalSpent"),
        readContract(pool, POOL_ABI, "expiry"),
        readContract(pool, POOL_ABI, "frozen"),
        readContract(pool, POOL_ABI, "perTxLimit"),
        readContract(pool, POOL_ABI, "allowedRecipientsLength"),
      ]);

    // Read allowed recipients
    const recipIndices  = Array.from({ length: Number(recipCount) }, (_, i) => i);
    const recipients    = await Promise.all(
      recipIndices.map(i => readContract(pool, POOL_ABI, "allowedRecipients", [BigInt(i)]))
    );

    const remaining     = BigInt(approvedAmount) - BigInt(totalSpent);
    const now           = Math.floor(Date.now() / 1000);
    const timeRemaining = Math.max(0, Number(expiry) - now);

    res.json({
      poolAddress: pool,
      agent,
      jobId:         jobId.toString(),
      approvedAmount: approvedAmount.toString(),
      totalSpent:    totalSpent.toString(),
      remaining:     remaining.toString(),
      perTxLimit:    perTxLimit.toString(),
      expiry:        expiry.toString(),
      expiryDate:    new Date(Number(expiry) * 1000).toISOString(),
      timeRemainingSeconds: timeRemaining,
      frozen,
      allowedRecipients: recipients,
      spentPct: approvedAmount > 0n
        ? Number((BigInt(totalSpent) * 10000n) / BigInt(approvedAmount)) / 100
        : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v2/pools/:poolAddress/spend — authenticated
// Validates a spend request and returns the spend() calldata for agent submission.
// The agent signs and submits the transaction themselves.
app.post("/v2/pools/:poolAddress/spend", verifyAgentAuth, async (req, res) => {
  const pool = req.params.poolAddress;
  const { recipient, amount, purpose } = req.body;
  if (!recipient || !amount) return res.status(400).json({ error: "recipient and amount required" });

  try {
    const [poolAgent, frozen, expiry, perTxLimit, totalSpent, approvedAmount] = await Promise.all([
      readContract(pool, POOL_ABI, "agent"),
      readContract(pool, POOL_ABI, "frozen"),
      readContract(pool, POOL_ABI, "expiry"),
      readContract(pool, POOL_ABI, "perTxLimit"),
      readContract(pool, POOL_ABI, "totalSpent"),
      readContract(pool, POOL_ABI, "approvedAmount"),
    ]);

    if (poolAgent.toLowerCase() !== req.verifiedAgent.toLowerCase())
      return res.status(403).json({ error: "Pool does not belong to this agent" });
    if (frozen)
      return res.status(400).json({ error: "Pool is frozen" });

    const now = Math.floor(Date.now() / 1000);
    if (Number(expiry) < now)
      return res.status(400).json({ error: "Pool has expired" });
    if (BigInt(amount) > BigInt(perTxLimit))
      return res.status(400).json({ error: `Amount ${amount} exceeds perTxLimit ${perTxLimit}` });
    if (BigInt(totalSpent) + BigInt(amount) > BigInt(approvedAmount))
      return res.status(400).json({ error: "Insufficient remaining pool balance" });

    // Purpose hash (bytes32)
    const purposeHash = keccak256(encodePacked(["string"], [purpose || ""]));

    res.json({
      valid: true,
      calldata: {
        contract:    pool,
        function:    "spend(address,uint128,bytes32)",
        args:        [recipient, amount, purposeHash],
        note:        "Agent submits this transaction from their own wallet.",
      },
      pool: {
        remaining: (BigInt(approvedAmount) - BigInt(totalSpent) - BigInt(amount)).toString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/agents/:address/eligibility — canonical eligibility endpoint (matches agent-card + llms.txt)
// Alias: GET /v2/agents/:agent (legacy, kept for back-compat)
app.get("/v1/agents/:agent/eligibility", async (req, res) => {
  if (!requireContracts(res)) return;
  const agent = req.params.agent;
  try {
    const [creditLimit, exposure, activeJobs, maxJobs, protoMax] = await Promise.all([
      readContract(CONTRACTS.financing, FINANCING_ABI, "creditLimits", [agent]).catch(() => 0n),
      readContract(CONTRACTS.hood, HOOD_ABI, "agentExposure", [agent]),
      readContract(CONTRACTS.hood, HOOD_ABI, "activeJobCount", [agent]),
      readContract(CONTRACTS.hood, HOOD_ABI, "maxJobsPerAgent"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "protocolMaximum"),
    ]);
    const effectiveLimit = creditLimit > 0n ? creditLimit : protoMax;
    const available = exposure < effectiveLimit ? effectiveLimit - exposure : 0n;
    res.json({
      agentAddress:   agent,
      eligible:       available > 0n && Number(activeJobs) < Number(maxJobs),
      credit: {
        limit:          effectiveLimit.toString(),
        used:           exposure.toString(),
        available:      available.toString(),
        isCustomLimit:  creditLimit > 0n,
      },
      jobs: {
        active:         Number(activeJobs),
        maxAllowed:     Number(maxJobs),
        slotsAvailable: Math.max(0, Number(maxJobs) - Number(activeJobs)),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v2/agents/:agent — legacy alias (kept for back-compat)
app.get("/v2/agents/:agent", async (req, res) => {
  if (!requireContracts(res)) return;
  const agent = req.params.agent;
  try {
    const [exposure, _maxPerAgent2, activeJobs, maxJobs, creditLimit, protoMax] = await Promise.all([
      readContract(CONTRACTS.hood, HOOD_ABI, "agentExposure", [agent]),
      readContract(CONTRACTS.hood, HOOD_ABI, "maxExposurePerAgent"),
      readContract(CONTRACTS.hood, HOOD_ABI, "activeJobCount", [agent]),
      readContract(CONTRACTS.hood, HOOD_ABI, "maxJobsPerAgent"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "creditLimits", [agent]).catch(() => 0n),
      readContract(CONTRACTS.financing, FINANCING_ABI, "protocolMaximum"),
    ]);

    const effectiveLimit = creditLimit > 0n ? creditLimit : protoMax;
    const available = exposure < effectiveLimit ? effectiveLimit - exposure : 0n;

    res.json({
      agent,
      credit: {
        limit:     effectiveLimit.toString(),
        used:      exposure.toString(),
        available: available.toString(),
      },
      jobs: {
        active:         Number(activeJobs),
        maxAllowed:     Number(maxJobs),
        slotsAvailable: Math.max(0, Number(maxJobs) - Number(activeJobs)),
      },
      note: "Full position history requires event indexing. Use GET /v2/positions/:jobId for individual positions.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v2/hood/status
// Hood security dashboard.
app.get("/v2/hood/status", async (req, res) => {
  if (!requireContracts(res)) return;
  try {
    const [paused, maxPerAgent, maxTotal, maxJobs, maxConc,
           totalAssets, outstanding, available] = await Promise.all([
      readContract(CONTRACTS.hood,    HOOD_ABI,  "paused"),
      readContract(CONTRACTS.hood,    HOOD_ABI,  "maxExposurePerAgent"),
      readContract(CONTRACTS.hood,    HOOD_ABI,  "maxExposureTotal"),
      readContract(CONTRACTS.hood,    HOOD_ABI,  "maxJobsPerAgent"),
      readContract(CONTRACTS.hood,    HOOD_ABI,  "maxConcentrationBps"),
      readContract(CONTRACTS.vault,   VAULT_ABI, "totalAssets"),
      readContract(CONTRACTS.vault,   VAULT_ABI, "outstandingPrincipal"),
      readContract(CONTRACTS.vault,   VAULT_ABI, "availableLiquidity"),
    ]);

    const utilPct = totalAssets > 0n
      ? Number((outstanding * 10000n) / totalAssets) / 100
      : 0;

    res.json({
      paused,
      limits: {
        maxExposurePerAgent:    maxPerAgent.toString(),
        maxExposureTotal:       maxTotal.toString(),
        maxJobsPerAgent:        Number(maxJobs),
        maxConcentrationBps:    Number(maxConc),
        maxConcentrationPct:    Number(maxConc) / 100,
      },
      vault: {
        totalAssets:   totalAssets.toString(),
        outstanding:   outstanding.toString(),
        available:     available.toString(),
        utilizationPct: utilPct,
      },
      emergencyStatus: paused ? "PAUSED" : "NORMAL",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v2/registry/:protocol
// Check if an external protocol is registered and its risk tier.
app.get("/v2/registry/:protocol", async (req, res) => {
  if (!requireContracts(res)) return;
  try {
    const isRegistered = await readContract(CONTRACTS.registry, REGISTRY_ABI, "isActive", [req.params.protocol, 0n]).catch(() => false);
    let adapterInfo = null;
    if (isRegistered) {
      const raw = await readContract(CONTRACTS.registry, REGISTRY_ABI, "adapters", [req.params.protocol]).catch(() => null);
      const TIER_NAMES = ["NATIVE", "VERIFIED", "ATTESTED"];
      adapterInfo = {
        adapter:  raw[0],
        tier:     TIER_NAMES[Number(raw[1])] || String(raw[1]),
        tierCode: Number(raw[1]),
        active:   raw[2],
      };
    }
    res.json({ protocol: req.params.protocol, registered: isRegistered, ...adapterInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── In-process route fetcher for MCP dispatcher ───────────────────────────

async function internalFetch(method, path, body) {
  return new Promise((resolve) => {
    // Build a minimal fake request/response pair
    const parts   = path.split("?")[0].split("/").filter(Boolean);
    const fakeReq = { method, path, params: {}, body: body || {}, headers: {} };
    const fakeRes = {
      _status: 200,
      status(c) { this._status = c; return this; },
      json(d)   { resolve({ ok: this._status < 400, data: d }); },
    };

    // Dispatch manually to avoid HTTP overhead
    if (method === "GET"  && path === "/v2/protocol")           return app._router.handle({ ...fakeReq, url: path, method: "GET" }, fakeRes, () => resolve({ ok: false, data: { error: "not found" } }));
    if (method === "GET"  && parts[1] === "agents" && parts[2]) { fakeReq.params.agent = parts[2]; return app._router.handle({ ...fakeReq, url: path, method: "GET" }, fakeRes, () => resolve({ ok: false, data: { error: "not found" } })); }
    if (method === "GET"  && parts[1] === "positions")          { fakeReq.params.jobId = parts[2]; return app._router.handle({ ...fakeReq, url: path, method: "GET" }, fakeRes, () => resolve({ ok: false, data: { error: "not found" } })); }
    if (method === "GET"  && parts[1] === "pools")              { fakeReq.params.poolAddress = parts[2]; return app._router.handle({ ...fakeReq, url: path, method: "GET" }, fakeRes, () => resolve({ ok: false, data: { error: "not found" } })); }
    if (method === "POST" && path === "/v2/jobs/verify")        return app._router.handle({ ...fakeReq, url: path, method: "POST" }, fakeRes, () => resolve({ ok: false, data: { error: "not found" } }));
    if (method === "POST" && path === "/v2/credit/quote")       return app._router.handle({ ...fakeReq, url: path, method: "POST" }, fakeRes, () => resolve({ ok: false, data: { error: "not found" } }));

    resolve({ ok: false, data: { error: "route not found for in-process dispatch" } });
  });
}

// Cache live protocol params, refreshed every 60s
let _liveParams = null;
let _liveParamsTs = 0;
async function getLiveParams() {
  const now = Date.now();
  if (_liveParams && now - _liveParamsTs < 60_000) return _liveParams;
  try {
    const [advBps, feeBps, protMax, perAgent, tvl, avail, outstanding] = await Promise.all([
      readContract(CONTRACTS.financing, FINANCING_ABI, "advanceRateBps"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "feeBps"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "protocolMaximum"),
      readContract(CONTRACTS.hood,      HOOD_ABI,      "maxExposurePerAgent"),
      readContract(CONTRACTS.vault,     VAULT_ABI,     "totalAssets"),
      readContract(CONTRACTS.vault,     VAULT_ABI,     "availableLiquidity"),
      readContract(CONTRACTS.vault,     VAULT_ABI,     "outstandingPrincipal"),
    ]);
    const advPct  = Number(advBps)  / 100;
    const feePct  = Number(feeBps)  / 100;
    const tvlUsdc = Number(tvl)     / 1e6;
    const availUsdc = Number(avail) / 1e6;
    const maxAgent  = Number(perAgent) / 1e6;
    const maxProto  = Number(protMax)  / 1e6;
    // worked example at $1000 job
    const exampleBudget  = 1000;
    const exampleAdvance = +(exampleBudget * advPct / 100).toFixed(2);
    const exampleFee     = +(exampleAdvance * feePct / 100).toFixed(2);
    // Version B mechanics: full advance deployed to pool (no deduction at draw).
    // Fee is added at repayment. Agent receives full advance in pool.
    // Settlement: vault receives advance + fee; agent receives remainder + any unspent pool balance.
    _liveParams = {
      advance_rate_pct:    advPct,
      advance_rate_bps:    Number(advBps),
      financing_fee_pct:   feePct,
      financing_fee_bps:   Number(feeBps),
      max_per_agent_usdc:  maxAgent,
      protocol_maximum_usdc: maxProto,
      usdc_decimals: 6,
      vault: {
        tvl_usdc:           tvlUsdc,
        available_usdc:     availUsdc,
        outstanding_usdc:   Number(outstanding) / 1e6,
        note: tvlUsdc === 0
          ? "Vault holds no liquidity yet — LP deposits needed before financing is available."
          : `${availUsdc.toFixed(2)} USDC available to lend.`,
      },
      fee_split: { lp_pct: 70, treasury_pct: 20, reserve_pct: 10 },
      example: {
        job_budget_usdc:                    exampleBudget,
        advance_to_pool_usdc:               exampleAdvance,
        financing_fee_usdc:                 exampleFee,
        agent_receives_at_draw_usdc:        exampleAdvance,
        total_repayment_usdc:               +(exampleAdvance + exampleFee).toFixed(2),
        settlement_remainder_to_agent_usdc: +(exampleBudget - exampleAdvance - exampleFee).toFixed(2),
        note: `Agent draws ${exampleAdvance} USDC and receives ${exampleAdvance} USDC in pool (no deduction at draw). The ${exampleFee} USDC fee (${feePct}%) is added at repayment. At settlement: Averis receives ${+(exampleAdvance+exampleFee).toFixed(2)} USDC, agent receives ${+(exampleBudget-exampleAdvance-exampleFee).toFixed(2)} USDC plus any unspent pool balance.`,
      },
      fetched_at: new Date().toISOString(),
    };
    _liveParamsTs = now;
  } catch (_e) {
    _liveParams = _liveParams || {
      note: "Could not fetch live params from chain. Using last known values.",
      advance_rate_pct: 40, financing_fee_pct: 2,
    };
  }
  return _liveParams;
}

function buildDiscoveryDoc(liveParams) {
  const terms = liveParams || {
    advance_rate_pct: 40, advance_rate_bps: 4000,
    financing_fee_pct: 2, financing_fee_bps: 200,
    max_per_agent_usdc: 10000, protocol_maximum_usdc: 50000,
    note: "Live chain read pending.",
  };
  return {
    protocol:       "Averis",
    version:        "2.0.0",
    status:         "testnet",
    network_note:   "Averis Finance is live on Arc Testnet (chain 5042002). Averis Passport is live on Arc Testnet (5042002) and Robinhood Chain Testnet (46630). USDC on these networks has no real-world value. Mainnet deployment is on the roadmap.",
    description:    "Averis is a two-product onchain protocol for autonomous AI agents. Averis Finance provides job-backed USDC working capital — agents draw a controlled spending pool against a funded job receivable. Averis Passport provides cross-chain agent identity and reputation — agents mint an ERC-8004 identity, commit capability policies, and accumulate verified economic receipts.",

    products: {
      finance: {
        name:        "Averis Finance",
        description: "Job-backed USDC working capital for autonomous agents. Draw up to 40% of a funded job budget as a controlled spending pool. Principal and fees repaid automatically at settlement.",
        status:      "live",
        chain:       "Arc Testnet (5042002)",
        launch_url:  "https://averisprotocol.xyz/finance",
        contracts:   CONTRACTS,
        contractsReady: contractsDeployed(),
        terms:       terms,
        default_consequences: {
          pool_frozen:          "The spending pool is frozen immediately — no further spending possible.",
          unspent_returned:     "Any unspent capital in the pool is returned to the vault automatically.",
          net_loss_written_off: "The net loss is written off against vault NAV. LP funds absorb the loss.",
          agent_liability:      "Non-recourse. The agent is NOT personally liable to repay if the job fails.",
        },
        eligibility_requirements: AGENT_CARD.eligibility_requirements,
        repayment:     AGENT_CARD.repayment,
        agent_journey: AGENT_CARD.agent_journey,
      },
      passport: {
        name:        "Averis Passport",
        description: "Cross-chain agent identity and reputation layer. Mint a non-transferable ERC-8004 identity token, commit capability policies via EIP-712 signatures, and accumulate verified economic receipts. Readable by any counterparty, platform, or observer.",
        status:      "live",
        chains:      ["Arc Testnet (5042002)", "Robinhood Chain Testnet (46630)"],
        launch_url:  "https://averisprotocol.xyz/passport",
        contracts: {
          IdentityRegistry:     "0x8004A818BFB912233c491871b3d84c89A494BD9e",
          ReputationRegistry:   "0x8004B663056A597Dffe9eCcC1965A193B7388713",
          ValidationRegistry:   "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
          AgentPolicyRegistry:  process.env.PASSPORT_POLICY_REGISTRY  || "0x018FcD301293B4D8ade587C08BA9Ea30A78C17C8",
          AgentReceiptRegistry: process.env.PASSPORT_RECEIPT_REGISTRY || "0xd24CEca0B911426aF3Dd659176A52E0816e0eDf6",
        },
        note: "ERC-8004 registry addresses are CREATE2-deterministic — same address on both chains.",
        read_endpoints: [
          "GET /v2/agents/:address/passport       — full passport summary",
          "GET /v2/agents/:address/identity       — ERC-8004 identity across chains",
          "GET /v2/agents/:address/capabilities   — declared capabilities",
          "GET /v2/agents/:address/policies       — policy commitments",
          "GET /v2/agents/:address/reputation     — reputation score and tier",
          "GET /v2/agents/:address/risk           — risk profile and signals",
          "GET /v2/agents/:address/transactions   — transaction history",
          "GET /v2/agents/:address/counterparties — counterparty graph",
          "GET /v2/agents/:address/agreements     — active agreements",
          "GET /v2/agents/:address/receipts       — verified receipts",
        ],
        action_endpoints: [
          "POST /v2/passport/identity/prepare-mint   — unsigned calldata to mint ERC-8004 identity (agent signs + broadcasts)",
          "POST /v2/passport/identity/verify         — verify agent identity onchain across both chains",
          "POST /v2/passport/policy/prepare-commit   — unsigned calldata to commit policy to AgentPolicyRegistry",
        ],
        agent_passport_journey: [
          "1. POST /v2/passport/identity/verify       — check if identity already exists",
          "2. POST /v2/passport/identity/prepare-mint — get unsigned calldata to mint",
          "3. Sign and broadcast returned transaction from agent wallet",
          "4. GET  /v2/agents/:address/identity       — confirm identity is live onchain",
          "5. POST /v2/passport/policy/prepare-commit — commit a capability policy",
          "6. GET  /v2/agents/:address/passport       — read full passport",
        ],
      },
    },

    // Legacy top-level fields kept for backward compatibility
    capabilities:   [...(AGENT_CARD.capabilities || []), "external_job_financing", "agent_identity", "agent_passport", "erc8004_identity", "policy_commitments", "economic_receipts"],
    keywords:       [...(AGENT_CARD.keywords || []), "passport", "identity", "reputation", "erc-8004", "policy", "receipts", "cross-chain identity"],
    chain:          AGENT_CARD.chain,
    contracts:      CONTRACTS,
    contractsReady: contractsDeployed(),
    protocol_terms: terms,
    authentication: AGENT_CARD.authentication,
    operator:       AGENT_CARD.operator,
    mcp: {
      endpoint:      `${AGENT_CARD.api.base_url}/v1/mcp`,
      endpoint_v2:   `${AGENT_CARD.api.base_url}/mcp`,
      protocol:      "MCP/1.0",
      tool_count:    MCP_TOOLS.length + MCP_PASSPORT_TOOLS.length,
      tools: [
        ...MCP_TOOLS.map((t) => ({
          name:              t.name,
          description:       t.description,
          category:          t.name.startsWith("averis_passport") ? "passport" : "finance",
          requiresAuth:      t.requiresAuth,
          "x-requires-auth": t.requiresAuth,
        })),
        ...MCP_PASSPORT_TOOLS.map((t) => ({
          name:              t.name,
          description:       t.description,
          category:          "passport",
          requiresAuth:      false,
          "x-requires-auth": false,
        })),
      ],
    },
    openapi:   `${AGENT_CARD.api.base_url}/openapi.json`,
    agentCard: `${AGENT_CARD.api.base_url}/.well-known/agent-card.json`,
    summary:   `${AGENT_CARD.api.base_url}/v1/summary`,
    llms_txt:  `${AGENT_CARD.api.base_url}/llms.txt`,
  };
}

// ── Discovery routes ───────────────────────────────────────────────────────

// GET /.well-known/agent-card.json — standard agent discovery
app.get("/.well-known/agent-card.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(AGENT_CARD);
});

// GET /openapi.json — OpenAPI 3.1 spec
app.get("/openapi.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(OPENAPI);
});

// GET /robots.txt — agent crawler hints
app.get("/robots.txt", (_req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.send([
    "User-agent: *",
    "Allow: /",
    "",
    "# Averis Protocol — Two-product onchain protocol for autonomous AI agents",
    "# Products: Averis Finance (working capital) + Averis Passport (identity & reputation)",
    "# Agent discovery:   /.well-known/agent-card.json",
    "# API discovery:     /v1/discover",
    "# OpenAPI spec:      /openapi.json",
    "# MCP tools:         /v1/mcp",
    "# LLM context:       /llms.txt",
    "# Finance app:       https://averisprotocol.xyz/finance",
    "# Passport app:      https://averisprotocol.xyz/passport",
    "# Keywords: agent working capital, agent financing, AI agent funding,",
    "#           USDC financing, agentic finance, job-backed credit,",
    "#           agent identity, agent passport, ERC-8004, agent reputation,",
    "#           cross-chain identity, policy commitments, economic receipts",
  ].join("\n"));
});

// GET /v1/discover — machine-readable capability discovery entry point
app.get("/v1/discover", async (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const liveParams = await getLiveParams();
  res.json(buildDiscoveryDoc(liveParams));
});

// GET /v1/summary — plain-text human/agent readable summary (no auth, CORS open)
// Designed to be readable by AI agents fetching via web_fetch or similar tools.
app.get("/v1/summary", async (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  const p = await getLiveParams();
  const advPct  = p.advance_rate_pct  ?? 40;
  const feePct  = p.financing_fee_pct ?? 2;
  const tvl     = p.vault?.tvl_usdc       ?? 0;
  const avail   = p.vault?.available_usdc ?? 0;
  const maxAgent= p.max_per_agent_usdc    ?? 10000;
  const maxProto= p.protocol_maximum_usdc ?? 50000;
  const ex      = p.example ?? {};
  res.send(`
AVERIS PROTOCOL — Working Capital for Autonomous AI Agents
==========================================================
Status:   TESTNET (Arc Testnet, chain 5042002)
Version:  2.0.0
Website:  https://averisprotocol.xyz
API:      https://api.averisprotocol.xyz
GitHub:   https://github.com/mosaro0224/averis-protocol

WHAT AVERIS DOES
----------------
Averis finances verified agent jobs. An agent with a funded job can draw
a temporary controlled spending pool to bridge a capital shortfall.
Principal and fees are repaid automatically from the job receivable at settlement.

FINANCING TERMS (live from chain)
----------------------------------
Advance rate:      ${advPct}% of job budget
Financing fee:     ${feePct}% of advance (flat, not annualized)
Max per agent:     ${maxAgent.toLocaleString()} USDC
Protocol maximum:  ${maxProto.toLocaleString()} USDC
Fee split:         70% to LPs, 20% to treasury, 10% to reserve

VAULT LIQUIDITY (live from chain)
-----------------------------------
Total vault assets:    ${tvl.toFixed(2)} USDC
Available to lend:     ${avail.toFixed(2)} USDC
Note: ${p.vault?.note ?? "See /v2/protocol for full vault status."}

WORKED EXAMPLE (Version B: full advance to pool, fee added at repayment)
------------------------------------------------------------------------
Job budget:                   ${ex.job_budget_usdc ?? 1000} USDC
Advance to pool (${advPct}%):      ${ex.advance_to_pool_usdc ?? (1000*advPct/100)} USDC
Agent receives at draw:       ${ex.agent_receives_at_draw_usdc ?? (1000*advPct/100)} USDC (full advance, no deduction)
Financing fee (${feePct}% at repay): ${ex.financing_fee_usdc ?? (1000*advPct/100*feePct/100)} USDC
Total repayment:              ${ex.total_repayment_usdc ?? (1000*advPct/100*(1+feePct/100))} USDC
Agent keeps at settlement:    ${ex.settlement_remainder_to_agent_usdc ?? (1000-1000*advPct/100*(1+feePct/100))} USDC plus any unspent pool balance

ELIGIBILITY REQUIREMENTS
-------------------------
1. Job must exist in a registered adapter protocol (AverisACP or ERC-8183 compatible)
2. Job must be funded and active (status: FUNDED)
3. Caller must be the job provider/agent address
4. Job payout receiver must be set to AverisReceivableRouter before funding
5. Job must not have expired
6. Job must not already have an active financing position
7. Agent exposure must not exceed per-agent cap (${maxAgent.toLocaleString()} USDC)
8. Requested amount must not exceed ${advPct}% of job budget

DEFAULT CONSEQUENCES
---------------------
- Spending pool is frozen immediately — no further spending possible.
- Unspent capital is returned to the vault automatically.
- Net loss is written off against vault NAV (LP funds absorb the loss).
- Agent is NOT personally liable — financing is non-recourse.
- No automatic blacklist in V2. Owner may manually restrict future credit.

HOW TO INTEGRATE
-----------------
Step 1: GET  /v1/discover           — capabilities, contracts, auth instructions
Step 2: GET  /v2/agents/:address    — check your credit profile and available credit
Step 3: POST /v2/jobs/verify        — confirm your job is eligible
Step 4: POST /v2/credit/quote       — get financing terms
Step 5: Submit draw() on-chain      — AverisFinancingV2 creates your spending pool
Step 6: POST /v2/pools/:pool/spend  — get validated spend() calldata
Step 7: Settlement automatic        — ReceivableRouter repays principal+fee

MCP TOOLS (POST /v1/mcp)
-------------------------
Send: {"method":"tools/list"} to enumerate all ${MCP_TOOLS.length + MCP_PASSPORT_TOOLS.length} tools (${MCP_TOOLS.length - 3} finance + 3 passport action + ${MCP_PASSPORT_TOOLS.length} passport read).
Modern endpoint: POST /mcp (MCP 2025-03-26 Streamable HTTP, all ${MCP_TOOLS.length + MCP_PASSPORT_TOOLS.length} tools).
Key tools: averis_discover, averis_check_eligibility, averis_get_quote,
           averis_request_funding (auth), averis_pool_status, averis_position_status

AUTHENTICATION
--------------
Read-only endpoints: no auth required.
Mutating actions:    EIP-712 signature in X-Agent-Signature header.
Domain: {name: "AverisProtocol", version: "2", chainId: 5042002}
Type:   AgentRequest{agentAddress, nonce, expiry, chainId}

FINANCE CONTRACT ADDRESSES (Arc Testnet 5042002)
------------------------------------------------
  AverisVault:           ${CONTRACTS.vault       || "(not set)"}
  AverisFinancingV2:     ${CONTRACTS.financing   || "(not set)"}
  AverisACP:             ${CONTRACTS.acp         || "(not set)"}
  ReceivableRouter:      ${CONTRACTS.router      || "(not set)"}
  AverisHood:            ${CONTRACTS.hood        || "(not set)"}
  AverisPoolFactory:     ${CONTRACTS.factory     || "(not set)"}
  AverisAdapterRegistry: ${CONTRACTS.registry    || "(not set)"}
  AverisCredit:          ${CONTRACTS.credit      || "(not set)"}

===========================================================
AVERIS PASSPORT — Cross-Chain Agent Identity & Reputation
===========================================================
Status:   LIVE on Arc Testnet (5042002) + Robinhood Chain Testnet (46630)
App:      https://averisprotocol.xyz/passport

WHAT PASSPORT DOES
------------------
Averis Passport is a non-custodial, cross-chain identity and reputation layer
for autonomous agents. It is NOT a financing product — it is an identity and
track-record layer that any agent, platform, or observer can read independently.

- ERC-8004 Identity:   Non-transferable identity token. Links all activity to
                       one verifiable wallet. Readable on both chains.
- Policy Commitments:  Agents commit to capability policies using EIP-712
                       signatures. Policies are versioned and revocable.
                       Stored in AgentPolicyRegistry on Robinhood Chain Testnet.
- Economic Receipts:   Append-only registry of verified economic activity.
                       Three states: SELF_REPORTED, AVERIS_VERIFIED, EXTERNAL_ATTESTER.
- Cross-chain:         Same identity readable on Arc Testnet and Robinhood Chain Testnet.
                       CREATE2-deterministic registry addresses.

PASSPORT CONTRACTS
------------------
  IdentityRegistry:     0x8004A818BFB912233c491871b3d84c89A494BD9e  (Arc + RH Testnet)
  ReputationRegistry:   0x8004B663056A597Dffe9eCcC1965A193B7388713  (Arc + RH Testnet)
  ValidationRegistry:   0x8004Cb1BF31DAf7788923b405b754f57acEB4272  (Arc + RH Testnet)
  AgentPolicyRegistry:  ${process.env.PASSPORT_POLICY_REGISTRY  || "0x018FcD301293B4D8ade587C08BA9Ea30A78C17C8"}  (Robinhood Chain Testnet 46630)
  AgentReceiptRegistry: ${process.env.PASSPORT_RECEIPT_REGISTRY || "0xd24CEca0B911426aF3Dd659176A52E0816e0eDf6"}  (Robinhood Chain Testnet 46630)

PASSPORT READ ENDPOINTS (no auth required)
-------------------------------------------
  GET /v2/agents/:address/passport       — full passport summary
  GET /v2/agents/:address/identity       — ERC-8004 identity across chains
  GET /v2/agents/:address/capabilities   — declared capabilities
  GET /v2/agents/:address/policies       — policy commitments
  GET /v2/agents/:address/reputation     — reputation score and tier
  GET /v2/agents/:address/risk           — risk profile and signals
  GET /v2/agents/:address/transactions   — transaction history
  GET /v2/agents/:address/counterparties — counterparty graph
  GET /v2/agents/:address/agreements     — active agreements
  GET /v2/agents/:address/receipts       — verified receipts

PASSPORT ACTION ENDPOINTS (agent signs + broadcasts — API never holds keys)
----------------------------------------------------------------------------
  POST /v2/passport/identity/prepare-mint    — unsigned calldata to mint ERC-8004 identity
    Body: { wallet, agentId, metadataURI, chainId }
    Returns: { transaction: { to, data, value, chainId }, registryAddress }

  POST /v2/passport/identity/verify          — verify agent identity onchain
    Body: { wallet } or { agentId } or { wallet, agentId, chainId }
    Returns: { verified, verifiedChains, identities[] }

  POST /v2/passport/policy/prepare-commit    — unsigned calldata to commit policy
    Body: { wallet, agentId, policyHash, contentURIHash, expiresAt }
    Returns: { transaction: { to, data, value, chainId: 46630 }, currentNonce, params }

AGENT PASSPORT JOURNEY
-----------------------
  1. POST /v2/passport/identity/verify       — check if identity already exists
  2. POST /v2/passport/identity/prepare-mint — get calldata to mint on Arc + RH Testnet
  3. Sign and broadcast returned transaction from agent wallet
  4. GET  /v2/agents/:address/identity       — confirm identity is live onchain
  5. POST /v2/passport/policy/prepare-commit — commit a capability policy
  6. GET  /v2/agents/:address/passport       — read full passport

IMPORTANT NOTES
---------------
- TESTNET ONLY. USDC on these networks has no real-world value.
- Unaudited. Do not use with real funds until third-party audit is completed.
- Finance vault currently holds ${tvl.toFixed(2)} USDC. Financing requires LP deposits.
- Mainnet deployment is on the roadmap after audit and vault seeding.
- Full API reference: GET /v1/discover
- OpenAPI spec:       GET /openapi.json
- Agent card:         GET /.well-known/agent-card.json
- LLMs context:       GET /llms.txt

Generated: ${new Date().toISOString()}
`.trim());
});

// POST /v1/mcp — MCP/1.0 tool dispatcher (legacy, kept for back-compat)
app.post("/v1/mcp", (req, res) => {
  const ctx = {
    chainId:      ARC_CHAIN_ID,
    contracts:    CONTRACTS,
    publicClient,
    discoveryDoc: buildDiscoveryDoc,
    fetch: (path) => internalFetch("GET",  path, null),
    post:  (path, body) => internalFetch("POST", path, body),
  };
  return handleMCP(req, res, ctx);
});

// ── Streamable HTTP MCP endpoint (/mcp) ───────────────────────────────────
// Implements MCP 2025-03-26 Streamable HTTP transport for registry compliance.
// POST  /mcp  — JSON-RPC messages (initialize, tools/list, tools/call)
// GET   /mcp  — SSE stream for server-to-client notifications
// DELETE /mcp — Session termination

const mcpSessions = new Map(); // sessionId → { createdAt }

function buildMcpCtx() {
  return {
    chainId:      ARC_CHAIN_ID,
    contracts:    CONTRACTS,
    publicClient,
    discoveryDoc: buildDiscoveryDoc,
    fetch: (path) => internalFetch("GET",  path, null),
    post:  (path, body) => internalFetch("POST", path, body),
  };
}

app.post("/mcp", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
  const body = req.body || {};

  // initialize — create a session
  if (body.method === "initialize") {
    const sessionId = `averis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mcpSessions.set(sessionId, { createdAt: Date.now() });
    // Evict sessions older than 1 hour
    for (const [id, s] of mcpSessions.entries()) {
      if (Date.now() - s.createdAt > 3_600_000) mcpSessions.delete(id);
    }
    return res.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "averis-protocol", version: "2.0.0" },
        sessionId,
      },
    });
  }

  // All other methods — validate session if header present
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && !mcpSessions.has(sessionId)) {
    return res.status(404).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32001, message: "Session not found" } });
  }

  // tools/list
  if (body.method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: {
        tools: [...MCP_TOOLS, ...MCP_PASSPORT_TOOLS].map((t) => ({
          name:        t.name,
          title:       t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
          ...(t["x-requires-auth"] ? { "x-requires-auth": true } : {}),
        })),
      },
    });
  }

  // tools/call — try passport tools first, then delegate to existing MCP dispatcher
  if (body.method === "tools/call") {
    const toolName = body.params?.name;
    const isPassportTool = MCP_PASSPORT_TOOLS.some(t => t.name === toolName);
    if (isPassportTool) {
      try {
        const result = await handleMCPPassport(toolName, body.params?.arguments ?? body.params?.input ?? {});
        return res.json({ jsonrpc: "2.0", id: body.id ?? null, result });
      } catch (err) {
        return res.status(500).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32000, message: err.message } });
      }
    }
    const ctx = buildMcpCtx();
    // Wrap in a fake req/res that captures the MCP response
    const fakeReq = { body: { method: "tools/call", params: body.params }, headers: req.headers };
    let captured = null;
    const fakeRes = {
      _status: 200,
      status(c) { this._status = c; return this; },
      json(d)   { captured = d; return this; },
    };
    await handleMCP(fakeReq, fakeRes, ctx);
    return res.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: captured,
    });
  }

  return res.status(400).json({
    jsonrpc: "2.0",
    id: body.id ?? null,
    error: { code: -32601, message: `Method not found: ${body.method}` },
  });
});

// GET /mcp — SSE stream for server-initiated notifications (required by spec)
app.get("/mcp", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.write(`data: ${JSON.stringify({ type: "ping", server: "averis-protocol", version: "2.0.0" })}\n\n`);
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 30_000);
  req.on("close", () => clearInterval(keepAlive));
});

// DELETE /mcp — session termination
app.delete("/mcp", (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId) mcpSessions.delete(sessionId);
  res.status(204).end();
});

// OPTIONS /mcp — CORS preflight
app.options("/mcp", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
  res.status(204).end();
});

// ── Agent Passport API Routes (/v2/agents/:address/*) ─────────────────────────
// These routes extend the existing API without breaking any existing Averis routes.
// All passport data is either onchain (via chain adapters) or offchain (passport-store).

// GET /v2/agents/:address/passport — full economic passport
app.get("/v2/agents/:address/passport", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const profile = await passportService.getEconomicProfile(req.params.address);
    res.json(profile);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v2/agents/:address/economic-profile — unified Averis Bank + Passport view
app.get("/v2/agents/:address/economic-profile", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const [profile, averis] = await Promise.all([
      passportService.getEconomicProfile(req.params.address),
      passportService.getAverisData(req.params.address),
    ]);
    res.json({ ...profile, averisBank: averis });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v2/agents/:address/identity
app.get("/v2/agents/:address/identity", async (req, res) => {
  try { res.json(await passportService.getIdentity(req.params.address)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v2/agents/:address/capabilities
app.get("/v2/agents/:address/capabilities", (req, res) => {
  res.json({ agentAddress: req.params.address, capabilities: passportStore.getCapabilities(req.params.address) });
});

// PUT /v2/agents/:address/capabilities — self-report capabilities (no auth required for testnet)
app.put("/v2/agents/:address/capabilities", (req, res) => {
  const { capabilities } = req.body;
  if (!Array.isArray(capabilities)) return res.status(400).json({ error: "capabilities must be an array" });
  passportStore.setCapabilities(req.params.address, capabilities);
  res.json({ ok: true, capabilities });
});

// GET /v2/agents/:address/policies — onchain policy registry reads
app.get("/v2/agents/:address/policies", async (req, res) => {
  try { res.json(await passportService.getPolicies(req.params.address)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v2/agents/:address/reputation — evidence-based reputation
app.get("/v2/agents/:address/reputation", (req, res) => {
  const addr = req.params.address.toLowerCase();
  const base = passportStore.getReputationEvidence(req.params.address);
  // Enrich from onchain event cache
  const agentEvents = eventCache.events.filter(e => e.agent && e.agent.toLowerCase() === addr);
  const onchainDraws   = agentEvents.filter(e => e.event === "Drawn").length;
  const onchainRepaid  = agentEvents.filter(e => e.event === "Repaid").length;
  const onchainDefault = agentEvents.filter(e => e.event === "Defaulted").length;
  res.json({
    agentAddress: req.params.address,
    evidence: {
      ...base,
      financingDraws:      onchainDraws,
      financingRepaid:     Math.max(base.financingRepaid, onchainRepaid),
      financingDefaulted:  onchainDefault,
      outstandingObligations: Math.max(base.outstandingObligations, onchainDraws - onchainRepaid - onchainDefault),
    },
    note: "Evidence-based reputation. Not a simplistic score. Each dimension is independently verifiable.",
    onchainEventsIndexed: agentEvents.length,
    lastIndexedBlock: eventCache.lastBlock?.toString(),
  });
});

// GET /v2/agents/:address/risk — Averis Bank risk profile
app.get("/v2/agents/:address/risk", async (req, res) => {
  try { res.json(await passportService.getAverisData(req.params.address)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /v2/agents/:address/agreements
app.get("/v2/agents/:address/agreements", (req, res) => {
  res.json({ agentAddress: req.params.address, agreements: passportStore.getAgreements(req.params.address) });
});

// POST /v2/agents/:address/agreements
app.post("/v2/agents/:address/agreements", (req, res) => {
  passportStore.addAgreement(req.params.address, req.body);
  res.json({ ok: true });
});

// GET /v2/agents/:address/transactions
app.get("/v2/agents/:address/transactions", (req, res) => {
  const { type, status, counterparty, limit, offset } = req.query;
  const lim    = limit  ? parseInt(limit)  : 50;
  const off    = offset ? parseInt(offset) : 0;
  const wallet = req.params.address.toLowerCase();

  // Merge passport-store transactions with live onchain events from event cache
  const storeData = passportStore.getTransactions(req.params.address, { type, status, counterparty, limit: 500, offset: 0 });

  // Map onchain events to transaction shape
  const onchainTxs = eventCache.events
    .filter(e => e.agent?.toLowerCase() === wallet)
    .map(e => ({
      id:          `onchain_${e.tx}_${e.event}`,
      type:        e.event === "Drawn" ? "FINANCING" : e.event === "Repaid" ? "CREDIT_REPAYMENT" : "DEFAULT",
      status:      e.event === "Drawn" ? "active" : e.event === "Repaid" ? "completed" : "failed",
      amount:      (Number(BigInt(e.amount || 0)) / 1e6).toFixed(2) + " USDC",
      jobId:       e.jobId,
      txHash:      e.tx,
      block:       e.block,
      timestamp:   null, // block timestamp not cached — use block number for ordering
      source:      "onchain",
    }));

  // Merge, deduplicate by txHash, sort newest block first
  const merged = [...storeData.items, ...onchainTxs]
    .filter((tx, idx, arr) => !tx.txHash || arr.findIndex(t => t.txHash === tx.txHash && t.type === tx.type) === idx);

  // Apply type/status filters
  let filtered = merged;
  if (type)   filtered = filtered.filter(t => t.type === type);
  if (status) filtered = filtered.filter(t => t.status === status);

  // Sort by block desc, then by id desc
  filtered.sort((a, b) => {
    const ba = BigInt(a.block || 0), bb = BigInt(b.block || 0);
    if (bb !== ba) return bb > ba ? 1 : -1;
    return (b.id > a.id ? 1 : -1);
  });

  res.json({ total: filtered.length, items: filtered.slice(off, off + lim), indexed_at: eventCache.updatedAt });
});

// POST /v2/agents/:address/transactions — record a transaction
app.post("/v2/agents/:address/transactions", (req, res) => {
  passportStore.addTransaction(req.params.address, req.body);
  res.json({ ok: true });
});

// GET /v2/agents/:address/counterparties
app.get("/v2/agents/:address/counterparties", (req, res) => {
  res.json({ agentAddress: req.params.address, counterparties: passportStore.getCounterparties(req.params.address) });
});

// GET /v2/agents/:address/receipts — onchain anchors + offchain metadata
app.get("/v2/agents/:address/receipts", async (req, res) => {
  try { res.json(await passportService.getReceipts(req.params.address)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /v2/agents/:address/receipts/meta — record offchain receipt metadata
app.post("/v2/agents/:address/receipts/meta", (req, res) => {
  passportStore.addReceiptMeta(req.params.address, req.body);
  res.json({ ok: true });
});

// POST /v2/agents/:address/identity/link — record a cross-chain identity link
app.post("/v2/agents/:address/identity/link", (req, res) => {
  const { caip2, agentId, registryAddress, metadataURI, linkTxHash } = req.body;
  if (!caip2 || agentId === undefined) return res.status(400).json({ error: "caip2 and agentId required" });
  passportStore.addIdentityLink(req.params.address, { caip2, agentId, registryAddress, metadataURI, linkTxHash });
  res.json({ ok: true });
});

// ── Passport action endpoints (Option A — unsigned calldata, agent signs + submits) ──

const ERC8004_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const PASSPORT_POLICY_REGISTRY  = process.env.PASSPORT_POLICY_REGISTRY  || "0x018FcD301293B4D8ade587C08BA9Ea30A78C17C8";
const PASSPORT_RECEIPT_REGISTRY = process.env.PASSPORT_RECEIPT_REGISTRY || "0xd24CEca0B911426aF3Dd659176A52E0816e0eDf6";

const RH_RPC_URL = process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
const RH_CHAIN_OBJ = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RH_RPC_URL] } },
};
let _rhPassportClient = null;
function getRhPassportClient() {
  if (!_rhPassportClient) _rhPassportClient = createPublicClient({ chain: RH_CHAIN_OBJ, transport: http(RH_RPC_URL) });
  return _rhPassportClient;
}

const IDENTITY_MINT_ABI = parseAbi([
  "function mint(address wallet, uint256 agentId, string metadataURI) external returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
]);

const POLICY_COMMIT_ABI = parseAbi([
  "function commitPolicy(bytes32 policyHash, bytes32 contentURI, uint64 expiresAt, uint256 agentId, address identityRegistry) external returns (uint256)",
  "function nonces(address agentWallet) view returns (uint256)",
]);

// POST /v2/passport/identity/prepare-mint
// Returns unsigned calldata for mint(wallet, agentId, metadataURI) on the IdentityRegistry.
// Agent signs and broadcasts. Supports chainId 5042002 (Arc) and 46630 (RH Testnet).
app.post("/v2/passport/identity/prepare-mint", async (req, res) => {
  const { wallet, agentId, metadataURI, chainId = 5042002 } = req.body;

  if (!wallet || agentId === undefined || !metadataURI) {
    return res.status(400).json({ error: "wallet, agentId, and metadataURI are required" });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return res.status(400).json({ error: "wallet must be a valid 0x address" });
  }
  // agentId is auto-assigned by the contract — ignore any provided value
  if (![5042002, 46630].includes(Number(chainId))) {
    return res.status(400).json({ error: "chainId must be 5042002 (Arc Testnet) or 46630 (Robinhood Chain Testnet)" });
  }

  try {
    // The IdentityRegistry uses register(string agentURI) — agentId is auto-assigned by the contract.
    // There is no mint(wallet, agentId, uri) function.
    const { encodeFunctionData } = await import("viem");
    const REGISTER_ABI = [{
      name: "register",
      type: "function",
      inputs: [{ name: "agentURI", type: "string" }],
      outputs: [{ name: "agentId", type: "uint256" }],
      stateMutability: "nonpayable",
    }];
    const calldata = encodeFunctionData({
      abi: REGISTER_ABI,
      functionName: "register",
      args: [metadataURI || ""],
    });

    const chainName = Number(chainId) === 46630 ? "Robinhood Chain Testnet" : "Arc Testnet";
    const explorer  = Number(chainId) === 46630
      ? "https://explorer.testnet.chain.robinhood.com"
      : "https://explorer.testnet.arc.io";

    return res.json({
      action: "register_identity",
      instructions: "Sign and broadcast this transaction from the wallet address. The agentId will be auto-assigned by the registry contract and returned in the transaction receipt logs.",
      transaction: {
        to:      ERC8004_IDENTITY_REGISTRY,
        data:    calldata,
        value:   "0x0",
        chainId: Number(chainId),
      },
      params: { wallet, metadataURI: metadataURI || "", chainId: Number(chainId) },
      chain: { id: Number(chainId), name: chainName, explorer },
      registryAddress: ERC8004_IDENTITY_REGISTRY,
      agentId_note: "agentId is auto-assigned by the contract. Read it from the Registered(agentId, agentURI, owner) event in the transaction receipt.",
      note: "On Arc Testnet, gas is paid in USDC. On Robinhood Chain Testnet, gas is paid in native RH token.",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to prepare register calldata", detail: err.message });
  }
});

// POST /v2/passport/identity/confirm-mint
// Called by agent after their mint tx confirms. Reads the tx receipt, extracts tokenId
// from the Transfer event log, and saves the wallet→tokenId mapping in passport store.
// This enables wallet-only identity lookup without needing to scan eth_getLogs.
app.post("/v2/passport/identity/confirm-mint", async (req, res) => {
  const { txHash, chainId, wallet } = req.body;
  if (!txHash || !wallet) return res.status(400).json({ error: "txHash and wallet are required" });

  const cid = Number(chainId) || 5042002;
  const client = cid === 46630 ? getRhPassportClient() : publicClient;
  const chainName = cid === 46630 ? "Robinhood Chain Testnet" : "Arc Testnet";

  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (!receipt) return res.status(404).json({ error: "Transaction not found or not yet confirmed" });
    if (receipt.status !== "success") return res.status(400).json({ error: "Transaction failed onchain" });

    // Extract tokenId from Transfer event (topic[3])
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    let tokenId = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === ERC8004_IDENTITY_REGISTRY.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 4) {
        tokenId = Number(BigInt(log.topics[3]));
        break;
      }
    }
    if (tokenId === null) return res.status(400).json({ error: "No Transfer event found in tx receipt" });

    // Save to passport store
    passportStore.addIdentityLink(wallet, {
      caip2: `eip155:${cid}`,
      chainId: cid,
      chainName,
      tokenId,
      txHash,
      registryAddress: ERC8004_IDENTITY_REGISTRY,
      confirmedAt: new Date().toISOString(),
    });

    return res.json({
      confirmed: true,
      wallet,
      tokenId,
      chainId: cid,
      chainName,
      txHash,
      registryAddress: ERC8004_IDENTITY_REGISTRY,
      message: `Identity token ${tokenId} confirmed for ${wallet} on ${chainName}. Wallet-only verify now works.`,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to confirm mint", detail: err.message });
  }
});

// POST /v2/passport/identity/verify
// Resolves the onchain identity for a wallet across Arc Testnet and Robinhood Chain Testnet.
// Returns verified identity records, chain coverage, and passport store links.
app.post("/v2/passport/identity/verify", async (req, res) => {
  const { wallet, agentId, chainId } = req.body;

  if (!wallet && agentId === undefined) {
    return res.status(400).json({ error: "wallet or agentId is required" });
  }

  const VERIFY_ABI = parseAbi([
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function balanceOf(address owner) view returns (uint256)",
  ]);

  // ERC-721 Transfer event: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  const chains = chainId
    ? [Number(chainId)]
    : [5042002, 46630];

  const results = await Promise.all(chains.map(async (cid) => {
    const client = cid === 46630 ? getRhPassportClient() : publicClient;
    const chainName = cid === 46630 ? "Robinhood Chain Testnet" : "Arc Testnet";
    const caip2 = `eip155:${cid}`;
    const rpcUrl = cid === 46630
      ? (process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com")
      : (process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io");

    try {
      if (agentId !== undefined) {
        // Resolve by specific tokenId
        const [owner, uri] = await Promise.all([
          client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi: VERIFY_ABI, functionName: "ownerOf", args: [BigInt(agentId)] }),
          client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi: VERIFY_ABI, functionName: "tokenURI", args: [BigInt(agentId)] }),
        ]);
        const matches = wallet ? owner.toLowerCase() === wallet.toLowerCase() : true;
        return { chainId: cid, chainName, caip2, tokenId: Number(agentId), wallet: owner, metadataURI: uri, verified: true, walletMatches: matches };
      } else {
        // Check balance first
        const balance = await client.readContract({
          address: ERC8004_IDENTITY_REGISTRY, abi: VERIFY_ABI, functionName: "balanceOf", args: [wallet],
        });
        if (Number(balance) === 0) {
          return { chainId: cid, chainName, caip2, verified: false, reason: "No identity found for this wallet on this chain. Mint via POST /v2/passport/identity/prepare-mint" };
        }

        // Scan Transfer events to wallet in batches to find tokenIds
        const latestHex = await fetch(rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
        }).then(r => r.json()).then(r => r.result);
        const latest = parseInt(latestHex, 16);
        const BATCH = 4999;
        const walletPadded = "0x" + "0".repeat(24) + wallet.slice(2).toLowerCase();
        let tokenIds = [];
        // Scan last 500k blocks in batches (tokens minted recently)
        for (let end = latest; end > Math.max(0, latest - 2000000) && tokenIds.length < 20; end -= BATCH) {
          const from = Math.max(0, end - BATCH);
          const logsRes = await fetch(rpcUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0", method: "eth_getLogs", id: 1,
              params: [{ address: ERC8004_IDENTITY_REGISTRY, topics: [TRANSFER_TOPIC, null, walletPadded], fromBlock: "0x" + from.toString(16), toBlock: "0x" + end.toString(16) }],
            }),
          }).then(r => r.json());
          const logs = logsRes.result || [];
          for (const log of logs) {
            const tid = parseInt(log.topics[3], 16);
            if (!tokenIds.includes(tid)) tokenIds.push(tid);
          }
          if (tokenIds.length >= Number(balance)) break;
        }

        if (tokenIds.length === 0) {
          // Fall back to passport store (populated by confirm-mint)
          const stored = passportStore.getIdentityLinks(wallet);
          const link = stored?.find(l => l.caip2 === caip2);
          if (link?.tokenId) tokenIds.push(link.tokenId);
        }
        if (tokenIds.length === 0) {
          return { chainId: cid, chainName, caip2, verified: false, reason: "Balance is non-zero but tokenId not found. Call POST /v2/passport/identity/confirm-mint with your mint txHash to register." };
        }

        // Verify current ownership and get metadata for first token
        const ownedTokens = [];
        for (const tid of tokenIds) {
          try {
            const owner = await client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi: VERIFY_ABI, functionName: "ownerOf", args: [BigInt(tid)] });
            if (owner.toLowerCase() === wallet.toLowerCase()) {
              const uri = await client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi: VERIFY_ABI, functionName: "tokenURI", args: [BigInt(tid)] });
              ownedTokens.push({ tokenId: tid, metadataURI: uri });
            }
          } catch { /* skip */ }
        }

        if (ownedTokens.length === 0) {
          return { chainId: cid, chainName, caip2, verified: false, reason: "Tokens transferred away — wallet no longer holds any identity tokens." };
        }

        return {
          chainId: cid, chainName, caip2, verified: true,
          tokenId: ownedTokens[0].tokenId,
          tokenIds: ownedTokens.map(t => t.tokenId),
          wallet,
          metadataURI: ownedTokens[0].metadataURI,
          identityCount: ownedTokens.length,
        };
      }
    } catch (err) {
      return { chainId: cid, chainName, caip2, verified: false, reason: `Lookup error: ${err.message}` };
    }
  }));

  const verifiedChains = results.filter(r => r.verified).map(r => r.caip2);
  return res.json({
    wallet:         wallet || null,
    agentId:        agentId !== undefined ? Number(agentId) : null,
    verified:       verifiedChains.length > 0,
    verifiedChains,
    chainsChecked:  chains.map(c => `eip155:${c}`),
    identities:     results,
    registryAddress: ERC8004_IDENTITY_REGISTRY,
    registryNote:   "Same contract address on Arc Testnet and Robinhood Chain Testnet (CREATE2 deterministic)",
    mintEndpoint:   "POST /v2/passport/identity/prepare-mint",
  });
});

// POST /v2/passport/policy/prepare-commit
// Returns unsigned calldata for commitPolicy() on AgentPolicyRegistry (RH Testnet).
// Also returns the EIP-712 struct the agent should sign as proof of intent.
// Agent encodes the tx, signs it with their wallet, and broadcasts to RH Testnet.
app.post("/v2/passport/policy/prepare-commit", async (req, res) => {
  const { wallet, agentId, policyHash, contentURIHash, expiresAt = 0 } = req.body;

  if (!wallet || agentId === undefined || !policyHash) {
    return res.status(400).json({ error: "wallet, agentId, and policyHash are required" });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return res.status(400).json({ error: "wallet must be a valid 0x address" });
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(policyHash)) {
    return res.status(400).json({ error: "policyHash must be a 32-byte hex string (0x + 64 hex chars)" });
  }
  const contentHash = contentURIHash && /^0x[0-9a-fA-F]{64}$/.test(contentURIHash)
    ? contentURIHash
    : "0x0000000000000000000000000000000000000000000000000000000000000000";

  try {
    // Read current nonce from PolicyRegistry on RH Testnet
    let nonce = 0;
    try {
      nonce = Number(await getRhPassportClient().readContract({
        address: PASSPORT_POLICY_REGISTRY,
        abi: POLICY_COMMIT_ABI,
        functionName: "nonces",
        args: [wallet],
      }));
    } catch { /* registry may not have this wallet yet — nonce 0 */ }

    const { encodeFunctionData } = await import("viem");
    // commitPolicy(bytes32 policyHash, bytes32 contentURI, uint64 expiresAt, uint256 agentId, address identityRegistry)
    // msg.sender must be the agent wallet — no agentWallet param
    const calldata = encodeFunctionData({
      abi: POLICY_COMMIT_ABI,
      functionName: "commitPolicy",
      args: [
        policyHash,
        contentHash,
        BigInt(expiresAt),
        BigInt(agentId),
        ERC8004_IDENTITY_REGISTRY,
      ],
    });

    return res.json({
      action: "commit_policy",
      instructions: "Sign and broadcast this transaction from the agent wallet to Robinhood Chain Testnet (chain 46630). Policy commitments are irreversible once confirmed.",
      transaction: {
        to:      PASSPORT_POLICY_REGISTRY,
        data:    calldata,
        value:   "0x0",
        chainId: 46630,
      },
      params: {
        wallet,
        agentId:        Number(agentId),
        identityRegistry: ERC8004_IDENTITY_REGISTRY,
        policyHash,
        contentURIHash: contentHash,
        expiresAt:      Number(expiresAt),
        currentNonce:   nonce,
      },
      chain: {
        id:       46630,
        name:     "Robinhood Chain Testnet",
        rpc:      RH_RPC_URL,
        explorer: "https://explorer.testnet.chain.robinhood.com",
      },
      registryAddress: PASSPORT_POLICY_REGISTRY,
      eip712_note: "policyHash should be keccak256 of the policy document. contentURIHash should be keccak256 of the IPFS URI pointing to the full policy content. Both are stored onchain as commitments — raw content is never stored onchain.",
      revocation_note: "Policy revocation is irreversible. Once revoked, the policy cannot be reinstated. A new policy commitment must be made.",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to prepare policy commit calldata", detail: err.message });
  }
});

// ── POST /v2/test/draw-cycle — server-side draw cycle test (uses Railway RPC access)
// Protected by TEST_SECRET env var. Remove after testing.
app.post("/v2/test/draw-cycle", async (req, res) => {
  if (!process.env.TEST_SECRET || req.headers["x-test-secret"] !== process.env.TEST_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!requireContracts(res)) return;

  const { createWalletClient, createPublicClient, http: viemHttp, parseAbi, decodeEventLog } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");

  const PK = process.env.TEST_WALLET_PRIVATE_KEY;
  if (!PK) return res.status(400).json({ error: "TEST_WALLET_PRIVATE_KEY not set" });

  // Derive two wallets: PROVIDER (agent) = PK, CLIENT = PK with last byte incremented
  const PK2 = "0x" + PK.slice(2, -2) + String(parseInt(PK.slice(-2), 16) + 1).padStart(2, "0");
  const USDC_ADDRESS = process.env.ARC_USDC || "0x3600000000000000000000000000000000000000";
  const arcChain = { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io"] } } };
  // PROVIDER = test wallet (the agent drawing capital)
  const providerAccount = privateKeyToAccount(PK);
  const PROVIDER = providerAccount.address;
  // CLIENT = second wallet (the client who creates and funds the job)
  const clientAccount = privateKeyToAccount(PK2);
  const CLIENT = clientAccount.address;
  // EVALUATOR = provider address rotated (just needs to differ from both)
  const EVALUATOR = CONTRACTS.hood; // Hood contract as dummy evaluator
  const wc  = createWalletClient({ account: providerAccount, chain: arcChain, transport: viemHttp(process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io") });
  const wc2 = createWalletClient({ account: clientAccount,   chain: arcChain, transport: viemHttp(process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io") });
  const pc  = createPublicClient({ chain: arcChain, transport: viemHttp(process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io") });

  const waitTx = async (hash) => {
    const r = await pc.waitForTransactionReceipt({ hash, timeout: 60000 });
    if (r.status !== "success") throw new Error(`TX reverted: ${hash}`);
    return r;
  };

  // Correct ACP ABI from source: AverisACP.sol
  const ACP_ABI = parseAbi([
    "function createJob(address provider, address evaluator, uint64 expiry, string description, address hook) returns (uint256 jobId)",
    "function setPayoutReceiver(uint256 jobId, address receiver)",
    "function setBudget(uint256 jobId, address token, uint128 amount, bytes calldata)",
    "function fund(uint256 jobId, address expectedToken, uint128 expectedBudget, bytes calldata)",
    "function getJob(uint256 jobId) view returns (address client, address provider, address evaluator, address token, address payoutReceiver, uint128 budget, uint128 funded, uint64 expiry, uint8 status)",
    "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider)",
  ]);
  const USDC_ABI = parseAbi([
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ]);
  const FINANCING_ABI_LOCAL = parseAbi([
    "function draw(address protocol, uint256 adapterId, uint256 jobId, uint128 amount, bytes obligationSig, address[] recipients) external",
  ]);

  const steps = [];
  try {
    // Step 1: vault state
    const totalAssets = await pc.readContract({ address: CONTRACTS.vault, abi: parseAbi(["function totalAssets() view returns (uint256)"]), functionName: "totalAssets" });
    const available = await pc.readContract({ address: CONTRACTS.vault, abi: parseAbi(["function availableLiquidity() view returns (uint256)"]), functionName: "availableLiquidity" });
    steps.push({ step: 1, name: "Vault state", totalAssets: totalAssets.toString(), available: available.toString() });

    // Step 2: eligibility via API (PROVIDER = agent drawing capital)
    const eligRes = await fetch(`http://localhost:${process.env.PORT || 3001}/v1/agents/${PROVIDER}/eligibility`).then(r => r.json());
    steps.push({ step: 2, name: "Eligibility", eligible: eligRes.eligible, creditAvailable: eligRes.credit?.available_usdc, provider: PROVIDER, client: CLIENT });

    // Step 2b: fund CLIENT wallet with USDC for job budget
    // On Arc, USDC is native — use sendTransaction with value (native transfer, 18 decimals)
    const jobBudget = 5_000_000n; // 5 USDC (6 decimals) — small to leave room for gas across both wallets
    const nativeAmount = jobBudget * 600_000_000_000n; // send 60% of jobBudget as native USDC for client gas + budget
    const fundClientTx = await wc.sendTransaction({ to: CLIENT, value: nativeAmount, gas: 21000n }); // send exactly 20 native USDC
    await waitTx(fundClientTx);
    steps.push({ step: "2b", name: "Funded client wallet", client: CLIENT, nativeAmount: nativeAmount.toString() });

    // Small delay to let Arc index the native transfer before using client wallet
    await new Promise(r => setTimeout(r, 3000));

    // Step 3: create job on ACP
    // CLIENT creates job with PROVIDER as the agent/provider, EVALUATOR = Hood contract
    // Flow: createJob (client) → setPayoutReceiver (provider) → setBudget (provider) → approve+fund (client)
    const expiry = BigInt(Math.floor(Date.now()/1000) + 86400 * 7);
    // Simulation confirmed sig: createJob(address,address,uint64,string,address)
    const createJobAbi = parseAbi(["function createJob(address,address,uint64,string,address) returns (uint256)"]);
    const createHash = await wc2.writeContract({
      address: CONTRACTS.acp, abi: createJobAbi, functionName: "createJob",
      args: [PROVIDER, EVALUATOR, expiry, "Averis draw test", "0x0000000000000000000000000000000000000000"],
      gas: 300000n
    });
    const createRcpt = await waitTx(createHash);
    const createTx = createHash;

    // Extract jobId from JobCreated event log
    let jobId = 0n;
    for (const log of createRcpt.logs) {
      try {
        const decoded = decodeEventLog({ abi: ACP_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "JobCreated") { jobId = decoded.args.jobId; break; }
      } catch {}
    }
    // Fallback: read nextJobId - 1
    if (!jobId) {
      const nextId = await pc.readContract({ address: CONTRACTS.acp, abi: parseAbi(["function nextJobId() view returns (uint256)"]), functionName: "nextJobId" }).catch(() => null);
      if (nextId) jobId = nextId - 1n;
    }
    if (!jobId) throw new Error("Could not extract jobId");

    // 3b: PROVIDER sets payout receiver to ReceivableRouter BEFORE funding (establishes lien)
    const lienTx = await wc.writeContract({ address: CONTRACTS.acp, abi: ACP_ABI, functionName: "setPayoutReceiver", args: [jobId, CONTRACTS.router], gas: 100000n });
    await waitTx(lienTx);

    // 3c: PROVIDER sets budget
    const setBudgetTx = await wc.writeContract({ address: CONTRACTS.acp, abi: ACP_ABI, functionName: "setBudget", args: [jobId, USDC_ADDRESS, jobBudget, "0x"], gas: 150000n });
    await waitTx(setBudgetTx);

    // 3d: CLIENT approves USDC for ACP
    const approveTx = await wc2.writeContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "approve", args: [CONTRACTS.acp, jobBudget], gas: 100000n });
    await waitTx(approveTx);

    // 3e: CLIENT funds job
    const fundTx = await wc2.writeContract({ address: CONTRACTS.acp, abi: ACP_ABI, functionName: "fund", args: [jobId, USDC_ADDRESS, jobBudget, "0x"], gas: 200000n });
    await waitTx(fundTx);

    steps.push({ step: 3, name: "Job created + lien + funded", jobId: jobId.toString(), budget: jobBudget.toString(), createTx, lienTx, fundTx });

    // Step 4: verify job via API
    const verifyRes = await fetch(`http://localhost:${process.env.PORT || 3001}/v2/jobs/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocol: CONTRACTS.acp, jobId: jobId.toString(), agentAddress: PROVIDER }),
    }).then(r => r.json());
    steps.push({ step: 4, name: "Job verified", eligible: verifyRes.eligible, warnings: verifyRes.warnings, job: verifyRes.job });

    // Step 5: quote via API
    const drawAmount = jobBudget * 4000n / 10000n; // 40% advance
    const quoteRes = await fetch(`http://localhost:${process.env.PORT || 3001}/v2/credit/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentAddress: PROVIDER, protocol: CONTRACTS.acp, jobId: jobId.toString(), requestedAmount: drawAmount.toString() }),
    }).then(r => r.json());
    const termsHash = quoteRes.termsHash || quoteRes.terms_hash;
    if (!termsHash) throw new Error("No termsHash from quote: " + JSON.stringify(quoteRes));
    steps.push({ step: 5, name: "Quote", drawAmount: drawAmount.toString(), repayment: quoteRes.totalRepayment || quoteRes.total_repayment, termsHash });

    // Step 6: draw onchain
    // draw(protocol, adapterId, jobId, amount, obligationSig, recipients)
    // LIEN mode: obligationSig = empty bytes, recipients = empty array (pool handles routing)
    const drawTx = await wc.writeContract({
      address: CONTRACTS.financing, abi: FINANCING_ABI_LOCAL, functionName: "draw",
      args: [CONTRACTS.acp, 0n, jobId, BigInt(drawAmount), "0x", []],
      gas: 3000000n
    });
    const drawRcpt = await waitTx(drawTx);
    steps.push({ step: 6, name: "Draw confirmed", drawTx, drawAmount: drawAmount.toString(), gasUsed: drawRcpt.gasUsed.toString() });

    // Step 7: position via API
    const posRes = await fetch(`http://localhost:${process.env.PORT || 3001}/v2/positions/${jobId}`).then(r => r.json());
    steps.push({ step: 7, name: "Position", poolAddress: posRes.poolAddress, status: posRes.status, principal: posRes.principal });

    res.json({ success: true, steps, summary: { jobId: jobId.toString(), drawAmount: drawAmount.toString(), drawTx, poolAddress: posRes.poolAddress } });
  } catch (err) {
    res.status(500).json({ success: false, steps, error: err.message });
  }
});

// ── Debug: simulate draw() to get revert reason
app.get("/v2/test/debug-draw", async (req, res) => {
  if (!process.env.TEST_SECRET || req.headers["x-test-secret"] !== process.env.TEST_SECRET) return res.status(403).json({ error: "Forbidden" });
  const { createPublicClient, http: viemHttp, parseAbi } = await import("viem");
  const arcChain = { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io"] } } };
  const pc = createPublicClient({ chain: arcChain, transport: viemHttp(process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io") });
  const PROVIDER = "0xd02Fe263b6F577b12558dA913027DC432f75CEb9";
  const jobId = BigInt(req.query.jobId || "3");
  const amount = BigInt(req.query.amount || "2000000");
  const abi = parseAbi(["function draw(address protocol, uint256 adapterId, uint256 jobId, uint128 amount, bytes obligationSig, address[] recipients) external"]);
  try {
    const result = await pc.simulateContract({
      address: CONTRACTS.financing, abi, functionName: "draw",
      args: [CONTRACTS.acp, 0n, jobId, amount, "0x", []],
      account: PROVIDER
    });
    res.json({ success: true, result: JSON.stringify(result.result) });
  } catch(e) {
    // Parse out the specific revert error
    const msg = e.message || '';
    const revertMatch = msg.match(/reverted with the following reason:\n\s*(.+)/);
    const customMatch = msg.match(/Error: (\w+)\(\)/);
    res.json({ success: false, error: msg.split('\n')[0], revertReason: revertMatch?.[1], customError: customMatch?.[1], fullCause: e.cause?.shortMessage });
  }
});

// GET /v1/activity — recent protocol events (must be before 404 handler)
app.get("/v1/activity", (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const limit = Math.min(parseInt(req.query.limit ?? "50"), 200);
  const agent = req.query.agent?.toLowerCase();
  let events = [...eventCache.events].reverse(); // newest first
  if (agent) events = events.filter(e => e.agent?.toLowerCase() === agent);
  res.json({
    events: events.slice(0, limit),
    total: eventCache.events.length,
    last_indexed_block: eventCache.lastBlock?.toString(),
    updated_at: eventCache.updatedAt,
  });
});

// ── 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    discovery: "GET /v1/discover",
    agentCard: "GET /.well-known/agent-card.json",
    availableRoutes: [
      "GET  /health",
      "GET  /v1/discover                              [agent discovery]",
      "GET  /v1/summary                               [plain-text summary]",
      "GET  /v1/activity                              [recent protocol events]",
      "POST /mcp                                      [MCP Streamable HTTP — registry standard]",
      "GET  /mcp                                      [MCP SSE stream]",
      "DELETE /mcp                                    [MCP session termination]",
      "POST /v1/mcp                                   [MCP/1.0 legacy tool dispatcher]",
      "GET  /.well-known/agent-card.json",
      "GET  /openapi.json",
      "GET  /robots.txt",
      "GET  /v2/protocol",
      "POST /v2/agents/verify",
      "POST /v2/jobs/verify",
      "POST /v2/credit/quote",
      "GET  /v2/positions/:jobId",
      "GET  /v2/pools/:poolAddress",
      "POST /v2/pools/:poolAddress/spend              [auth]",
      "GET  /v1/agents/:address/eligibility           [agent eligibility + credit profile]",
      "GET  /v2/agents/:agent                         [legacy alias for eligibility]",
      "GET  /v2/hood/status",
      "GET  /v2/registry/:protocol",
      "GET  /v2/agents/:address/passport              [full economic passport]",
      "GET  /v2/agents/:address/economic-profile      [passport + Averis Bank unified]",
      "GET  /v2/agents/:address/identity              [ERC-8004 identity across chains]",
      "GET  /v2/agents/:address/capabilities          [declared capabilities]",
      "PUT  /v2/agents/:address/capabilities          [update capabilities]",
      "GET  /v2/agents/:address/policies              [onchain EIP-712 policies]",
      "GET  /v2/agents/:address/reputation            [evidence-based reputation]",
      "GET  /v2/agents/:address/risk                  [Averis Bank risk profile]",
      "GET  /v2/agents/:address/agreements",
      "POST /v2/agents/:address/agreements",
      "GET  /v2/agents/:address/transactions",
      "POST /v2/agents/:address/transactions",
      "GET  /v2/agents/:address/counterparties",
      "GET  /v2/agents/:address/receipts              [onchain anchors + offchain metadata]",
      "POST /v2/agents/:address/receipts/meta",
      "POST /v2/agents/:address/identity/link",
      "POST /v2/passport/identity/prepare-mint    [calldata: mint ERC-8004 identity on Arc or RH Testnet]",
      "POST /v2/passport/identity/verify          [verify identity onchain across Arc + RH Testnet]",
      "POST /v2/passport/policy/prepare-commit    [calldata: commit EIP-712 policy to AgentPolicyRegistry]",
    ],
  });
});

// ── Lightweight event indexer ──────────────────────────────────────────────
// Scans AverisFinancingV2 events in 2000-block chunks and caches in memory.
// Refreshes every 5 minutes. Exposes GET /v1/activity.

const EVENT_ABI = parseAbi([
  "event Drawn(uint256 indexed jobId, address indexed agent, uint256 principal, uint256 fee, address pool, uint8 tier, uint8 repayMode)",
  "event Repaid(uint256 indexed jobId, uint256 principal, uint256 fee)",
  "event Defaulted(uint256 indexed jobId, uint8 status, uint256 principalLoss)",
]);

let eventCache = { events: [], lastBlock: 0n, updatedAt: null };
const jobAgentMap = {}; // jobId -> agent address (populated from Drawn events)

async function refreshEventIndex() {
  try {
    const latest = await publicClient.getBlockNumber();
    const fromBlock = eventCache.lastBlock > 0n
      ? eventCache.lastBlock + 1n
      : (latest > 10000n ? latest - 10000n : 0n); // scan last 10k blocks on first run
    if (fromBlock > latest) return;

    const chunkSize = 2000n;
    const newEvents = [];
    for (let from = fromBlock; from <= latest; from += chunkSize) {
      const to = from + chunkSize - 1n < latest ? from + chunkSize - 1n : latest;
      const logs = await publicClient.getLogs({
        address: CONTRACTS.financing,
        events: EVENT_ABI,
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        const jobIdStr = log.args.jobId?.toString();
        // Track agent by jobId from Drawn events
        if (log.eventName === "Drawn" && log.args.agent) jobAgentMap[jobIdStr] = log.args.agent;
        const agent = log.args.agent ?? jobAgentMap[jobIdStr] ?? null;
        newEvents.push({
          event:   log.eventName,
          agent,
          jobId:   jobIdStr,
          amount:  (log.args.principal ?? log.args.principalLoss ?? 0n).toString(),
          fee:     log.args.fee?.toString() ?? "0",
          pool:    log.args.pool ?? null,
          block:   log.blockNumber?.toString(),
          tx:      log.transactionHash,
        });
      }
    }
    eventCache.events = [...eventCache.events, ...newEvents].slice(-500); // keep last 500
    eventCache.lastBlock = latest;
    eventCache.updatedAt = new Date().toISOString();
    if (newEvents.length > 0) console.log(`Indexed ${newEvents.length} new events (total ${eventCache.events.length})`);
  } catch (err) {
    console.error("Event indexer error:", err.message);
  }
}

// Run on startup and every 5 minutes
refreshEventIndex();
setInterval(refreshEventIndex, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Averis V2 API running on port ${PORT}`);
  console.log(`Chain: ${ARC_CHAIN_ID} @ ${ARC_RPC_URL}`);
  console.log(`Contracts deployed: ${contractsDeployed()}`);
});

export default app;
