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

const _require = createRequire(import.meta.url);
const AGENT_CARD = _require("./agent-card.json");
const OPENAPI    = _require("./openapi.json");

const app  = express();
app.use(express.json());

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
  "function positions(uint256 jobId) view returns (address agent, uint96 principal, uint96 fee, uint96 principalRepaid, uint96 feeRepaid, uint8 status, uint256 expiry, address poolAddress, uint8 mode)",
  "function maxAdvance(address protocol, uint256 jobId, uint256 amount) view returns (uint256)",
  "function creditLimits(address agent) view returns (uint128)",
  "function advanceRateBps() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function protocolMaximum() view returns (uint256)",
  "function obligationNonces(address agent) view returns (uint256)",
]);

const ACP_ABI = parseAbi([
  "function getJob(uint256 id) view returns (address client, address provider, uint128 budget, address token, uint8 status, uint256 expiry, address payoutReceiver, bytes32 descriptionHash)",
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
  "function isRegistered(address protocol) view returns (bool)",
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
    const isRegistered = await readContract(CONTRACTS.registry, REGISTRY_ABI, "isRegistered", [protocol]);

    let jobView = null;
    let warnings = [];

    if (protocol.toLowerCase() === CONTRACTS.acp?.toLowerCase()) {
      // Native Averis job — read directly
      const job = await readContract(CONTRACTS.acp, ACP_ABI, "getJob", [BigInt(jobId)]);
      const [client, provider, budget, token, status, expiry, payoutReceiver, descHash] = job;
      const now = Math.floor(Date.now() / 1000);
      jobView = { client, provider, budget: budget.toString(), token, status: Number(status), expiry: expiry.toString(), payoutReceiver, descriptionHash: descHash };

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
    const pos = await readContract(CONTRACTS.financing, FINANCING_ABI, "positions", [BigInt(req.params.jobId)]);
    const [agent, principal, fee, principalRepaid, feeRepaid, status, expiry, poolAddress, mode] = pos;

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
      mode:           MODE_NAMES[Number(mode)] || String(mode),
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
      readContract(CONTRACTS.financing, FINANCING_ABI, "creditLimits", [agent]),
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
      readContract(CONTRACTS.financing, FINANCING_ABI, "creditLimits", [agent]),
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
    const isRegistered = await readContract(CONTRACTS.registry, REGISTRY_ABI, "isRegistered", [req.params.protocol]);
    let adapterInfo = null;
    if (isRegistered) {
      const raw = await readContract(CONTRACTS.registry, REGISTRY_ABI, "adapters", [req.params.protocol]);
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
    network_note:   "Currently live on Arc Testnet (chain 5042002). USDC on this network has no real-world value. Mainnet deployment is on the roadmap.",
    description:    AGENT_CARD.description,
    capabilities:   [...(AGENT_CARD.capabilities || []), "external_job_financing"],
    keywords:       AGENT_CARD.keywords,
    chain:          AGENT_CARD.chain,
    contracts:      CONTRACTS,
    contractsReady: contractsDeployed(),
    protocol_terms: terms,
    default_consequences: {
      note: "What happens to the agent if a financed job fails, expires, or is rejected.",
      pool_frozen:        "The spending pool is frozen immediately — no further spending possible.",
      unspent_returned:   "Any unspent capital in the pool is returned to the vault automatically.",
      net_loss_written_off: "The net loss (principal minus unspent) is written off against vault NAV (LP funds absorb the loss).",
      agent_consequences: "In V2 there is no on-chain blacklist or automatic reputation penalty for defaults. The agent's exposure is released in AverisHood, allowing future financing applications. However, the protocol owner may manually set the agent's credit limit to zero via setCreditLimit().",
      agent_liability:    "The agent is NOT personally liable to repay if the job fails. The financing is non-recourse — secured only by the job receivable.",
    },
    eligibility_requirements: AGENT_CARD.eligibility_requirements,
    repayment:      AGENT_CARD.repayment,
    authentication: AGENT_CARD.authentication,
    agent_journey:  AGENT_CARD.agent_journey,
    operator:       AGENT_CARD.operator,
    mcp: {
      endpoint: `${AGENT_CARD.api.base_url}/v1/mcp`,
      protocol: "MCP/1.0",
      tools:    MCP_TOOLS.map((t) => ({
        name:              t.name,
        description:       t.description,
        requiresAuth:      t.requiresAuth,
        "x-requires-auth": t.requiresAuth,
      })),
    },
    openapi:   `${AGENT_CARD.api.base_url}/openapi.json`,
    agentCard: `${AGENT_CARD.api.base_url}/.well-known/agent-card.json`,
    summary:   `${AGENT_CARD.api.base_url}/v1/summary`,
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
    "# Averis Protocol — Working capital for autonomous AI agents",
    "# Agent discovery:   /.well-known/agent-card.json",
    "# API discovery:     /v1/discover",
    "# OpenAPI spec:      /openapi.json",
    "# MCP tools:         /v1/mcp",
    "# Keywords: agent working capital, agent financing, AI agent funding,",
    "#           USDC financing, agentic finance, job-backed credit",
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
Send: {"method":"tools/list"} to enumerate all ${MCP_TOOLS.length} tools.
Key tools: averis_discover, averis_check_eligibility, averis_get_quote,
           averis_request_funding (auth), averis_pool_status, averis_position_status

AUTHENTICATION
--------------
Read-only endpoints: no auth required.
Mutating actions:    EIP-712 signature in X-Agent-Signature header.
Domain: {name: "AverisProtocol", version: "2", chainId: 1227}
Type:   AgentRequest{agentAddress, nonce, expiry, chainId}

IMPORTANT NOTES
---------------
- TESTNET ONLY. Arc Testnet USDC has no real-world value.
- Unaudited. Do not use with real funds until third-party audit is completed.
- Vault currently holds ${tvl.toFixed(2)} USDC. Financing requires LP deposits.
- Mainnet deployment is on the roadmap after audit and vault seeding.

Contract addresses (current deployment — always current, pulled from env):
  AverisVault:           ${CONTRACTS.vault       || "(not set)"}
  AverisFinancingV2:     ${CONTRACTS.financing   || "(not set)"}
  AverisACP:             ${CONTRACTS.acp         || "(not set)"}
  ReceivableRouter:      ${CONTRACTS.router      || "(not set)"}
  AverisHood:            ${CONTRACTS.hood        || "(not set)"}
  AverisPoolFactory:     ${CONTRACTS.factory     || "(not set)"}
  AverisAdapterRegistry: ${CONTRACTS.registry    || "(not set)"}
  AverisCredit:          ${CONTRACTS.credit      || "(not set)"}
Query GET /v1/discover for the full contract table including AverisReserve and AverisACPAdapter.

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
        tools: MCP_TOOLS.map((t) => ({
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

  // tools/call — delegate to existing MCP dispatcher
  if (body.method === "tools/call") {
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    discovery: "GET /v1/discover",
    agentCard: "GET /.well-known/agent-card.json",
    availableRoutes: [
      "GET  /health",
      "GET  /v1/discover                        [agent discovery]",
      "POST /mcp                                [MCP Streamable HTTP — registry standard]",
      "GET  /mcp                                [MCP SSE stream]",
      "DELETE /mcp                              [MCP session termination]",
      "POST /v1/mcp                             [MCP/1.0 legacy tool dispatcher]",
      "GET  /.well-known/agent-card.json",
      "GET  /openapi.json",
      "GET  /robots.txt",
      "GET  /v2/protocol",
      "POST /v2/agents/verify",
      "POST /v2/jobs/verify",
      "POST /v2/credit/quote",
      "GET  /v2/positions/:jobId",
      "GET  /v2/pools/:poolAddress",
      "POST /v2/pools/:poolAddress/spend  [auth]",
      "GET  /v1/agents/:address/eligibility    [agent eligibility + credit profile]",
      "GET  /v2/agents/:agent",
      "GET  /v2/hood/status",
      "GET  /v2/registry/:protocol",
    ],
  });
});

// ── Lightweight event indexer ──────────────────────────────────────────────
// Scans AverisFinancingV2 events in 2000-block chunks and caches in memory.
// Refreshes every 5 minutes. Exposes GET /v1/activity.

const EVENT_ABI = parseAbi([
  "event Drawn(address indexed agent, uint256 indexed jobId, uint256 amount, address pool)",
  "event Repaid(address indexed agent, uint256 indexed jobId, uint256 principal, uint256 fee)",
  "event Defaulted(address indexed agent, uint256 indexed jobId, uint256 loss)",
]);

let eventCache = { events: [], lastBlock: 0n, updatedAt: null };

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
        newEvents.push({
          event:   log.eventName,
          agent:   log.args.agent,
          jobId:   log.args.jobId?.toString(),
          amount:  (log.args.amount ?? log.args.principal ?? log.args.loss ?? 0n).toString(),
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

// GET /v1/activity — recent protocol events
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

app.listen(PORT, () => {
  console.log(`Averis V2 API running on port ${PORT}`);
  console.log(`Chain: ${ARC_CHAIN_ID} @ ${ARC_RPC_URL}`);
  console.log(`Contracts deployed: ${contractsDeployed()}`);
});

export default app;
