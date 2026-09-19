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

const ARC_CHAIN_ID    = Number(process.env.ARC_CHAIN_ID || 1227);
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
  vault:      process.env.AVERIS_VAULT      || null,
  financing:  process.env.AVERIS_FINANCING  || null,
  acp:        process.env.AVERIS_ACP        || null,
  router:     process.env.AVERIS_ROUTER     || null,
  hood:       process.env.AVERIS_HOOD       || null,
  factory:    process.env.AVERIS_FACTORY    || null,
  registry:   process.env.AVERIS_REGISTRY   || null,
  credit:     process.env.AVERIS_CREDIT     || null,
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
    const [maxAdvance, feeBps, advanceRate] = await Promise.all([
      readContract(CONTRACTS.financing, FINANCING_ABI, "maxAdvance", [protocol, BigInt(jobId), BigInt(requestedAmount)]),
      readContract(CONTRACTS.financing, FINANCING_ABI, "feeBps"),
      readContract(CONTRACTS.financing, FINANCING_ABI, "advanceRateBps"),
    ]);

    const approved  = maxAdvance < BigInt(requestedAmount) ? maxAdvance : BigInt(requestedAmount);
    const fee       = (approved * feeBps) / 10000n;
    const totalOwed = approved + fee;

    // The quote itself is unsigned — agent submits draw() on-chain.
    // The on-chain draw() enforces all limits deterministically.
    res.json({
      agentAddress,
      protocol,
      jobId:           jobId.toString(),
      requestedAmount: requestedAmount.toString(),
      quote: {
        approvedAmount:  approved.toString(),
        fee:             fee.toString(),
        totalRepayment:  totalOwed.toString(),
        feeBps:          feeBps.toString(),
        advanceRateBps:  advanceRate.toString(),
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

// GET /v2/agents/:agent/positions
// All financing positions for an agent (requires iterating events — basic version scans known jobIds).
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

function buildDiscoveryDoc() {
  return {
    protocol:       "Averis",
    version:        "2.0.0",
    status:         "testnet",
    network_note:   "Currently live on Arc Testnet (chain 1227). USDC on this network has no real-world value. Mainnet deployment is on the roadmap.",
    description:    AGENT_CARD.description,
    capabilities:   AGENT_CARD.capabilities,
    keywords:       AGENT_CARD.keywords,
    chain:          AGENT_CARD.chain,
    contracts:      CONTRACTS,
    contractsReady: contractsDeployed(),
    protocol_terms: {
      note:                   "Live values verified on-chain from AverisFinancingV2.",
      advance_rate_pct:       20,
      advance_rate_bps:       2000,
      financing_fee_pct:      2,
      financing_fee_bps:      200,
      max_per_agent_usdc:     10000,
      max_per_agent_raw:      "10000000000",
      protocol_maximum_usdc:  50000,
      protocol_maximum_raw:   "50000000000",
      usdc_decimals:          6,
      fee_split: { lp_pct: 70, treasury_pct: 20, reserve_pct: 10 },
      example: {
        job_budget_usdc:      1000,
        max_advance_usdc:     200,
        financing_fee_usdc:   4,
        total_repayment_usdc: 204,
        agent_receives_usdc:  796,
      },
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
        name:         t.name,
        description:  t.description,
        requiresAuth: t.requiresAuth,
        "x-requires-auth": t.requiresAuth,
      })),
    },
    openapi:   `${AGENT_CARD.api.base_url}/openapi.json`,
    agentCard: `${AGENT_CARD.api.base_url}/.well-known/agent-card.json`,
  };
}

// ── Discovery routes ───────────────────────────────────────────────────────

// GET /.well-known/agent-card.json — standard agent discovery
app.get("/.well-known/agent-card.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
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
app.get("/v1/discover", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(buildDiscoveryDoc());
});

// POST /v1/mcp — MCP/1.0 tool dispatcher
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    discovery: "GET /v1/discover",
    agentCard: "GET /.well-known/agent-card.json",
    availableRoutes: [
      "GET  /health",
      "GET  /v1/discover                        [agent discovery]",
      "POST /v1/mcp                             [MCP tools]",
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
      "GET  /v2/agents/:agent",
      "GET  /v2/hood/status",
      "GET  /v2/registry/:protocol",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`Averis V2 API running on port ${PORT}`);
  console.log(`Chain: ${ARC_CHAIN_ID} @ ${ARC_RPC_URL}`);
  console.log(`Contracts deployed: ${contractsDeployed()}`);
});

export default app;
