/**
 * Averis Protocol — MCP/1.0 Tool Dispatcher
 *
 * Exposes Averis agent capabilities as structured MCP tools for
 * MCP-compatible AI frameworks (Claude, GPT, LangChain, etc.).
 *
 * Protocol: POST /v1/mcp
 *   { method: "tools/list" }
 *   { method: "tools/call", params: { name, arguments } }
 *
 * Auth: tools marked requiresAuth: true expect agentAddress, nonce,
 * expiry, and signature inside tool arguments. The dispatcher
 * re-uses the server's verifyAgentAuth logic before dispatching.
 */

import { recoverTypedDataAddress } from "viem";

// ── Tool definitions ──────────────────────────────────────────────────────

export const MCP_TOOLS = [
  {
    name: "averis_discover",
    description: "Discover Averis Protocol capabilities, contract addresses, financing parameters, authentication requirements, and the complete agent journey. Call this first to understand how to interact with Averis.",
    requiresAuth: false,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "averis_protocol_status",
    description: "Get live protocol statistics: total value locked, available liquidity, outstanding principal, utilization rate, and Hood security status.",
    requiresAuth: false,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "averis_check_eligibility",
    description: "Check whether an agent address is eligible for financing. Returns credit limit, current exposure, available credit, active job count, and remaining job slots.",
    requiresAuth: false,
    inputSchema: {
      type: "object",
      properties: {
        agentAddress: {
          type: "string",
          description: "Agent wallet address (0x...)",
        },
      },
      required: ["agentAddress"],
    },
  },
  {
    name: "averis_verify_job",
    description: "Verify a job is eligible for Averis financing. Checks that the job exists, is funded, has not expired, the agent is the provider, and the payout receiver is set to the ReceivableRouter (lien established). Returns the maximum advance amount.",
    requiresAuth: false,
    inputSchema: {
      type: "object",
      properties: {
        protocol:        { type: "string", description: "Job protocol contract address (use AverisACP address for native jobs)" },
        jobId:           { type: "string", description: "Job ID as a decimal string" },
        agentAddress:    { type: "string", description: "Agent wallet address (optional — used for provider check)" },
        requestedAmount: { type: "string", description: "Requested USDC amount in raw units (6 decimals, optional)" },
      },
      required: ["protocol", "jobId"],
    },
  },
  {
    name: "averis_get_quote",
    description: "Get a financing quote for a job. Returns the approved amount, financing fee, total repayment obligation, and the on-chain calldata the agent must submit to create the spending pool.",
    requiresAuth: false,
    inputSchema: {
      type: "object",
      properties: {
        agentAddress:    { type: "string", description: "Agent wallet address" },
        protocol:        { type: "string", description: "Job protocol contract address" },
        jobId:           { type: "string", description: "Job ID as a decimal string" },
        requestedAmount: { type: "string", description: "Requested USDC amount in raw units (6 decimals)" },
      },
      required: ["agentAddress", "protocol", "jobId", "requestedAmount"],
    },
  },
  {
    name: "averis_request_funding",
    description: "Validate a funding request and return the draw() calldata for the agent to submit on-chain. This creates the controlled spending pool. REQUIRES EIP-712 authentication: include agentAddress, nonce, expiry, and signature in arguments.",
    requiresAuth: true,
    "x-requires-auth": true,
    inputSchema: {
      type: "object",
      properties: {
        agentAddress:    { type: "string", description: "Agent wallet address" },
        protocol:        { type: "string", description: "Job protocol contract address" },
        jobId:           { type: "string", description: "Job ID as a decimal string" },
        requestedAmount: { type: "string", description: "Requested USDC amount in raw units (6 decimals)" },
        nonce:           { type: "string", description: "Monotonically increasing nonce (use obligationNonces from financing contract)" },
        expiry:          { type: "string", description: "Unix timestamp — signature validity expiry" },
        signature:       { type: "string", description: "EIP-712 signature: sign {agentAddress, nonce, expiry, chainId} over AverisProtocol v2 domain" },
      },
      required: ["agentAddress", "protocol", "jobId", "requestedAmount", "nonce", "expiry", "signature"],
    },
  },
  {
    name: "averis_pool_status",
    description: "Get the current state of a job-specific spending pool: balance, amount spent, per-transaction limit, allowed recipients, expiry, and frozen status.",
    requiresAuth: false,
    inputSchema: {
      type: "object",
      properties: {
        poolAddress: { type: "string", description: "Spending pool contract address (from position.poolAddress)" },
      },
      required: ["poolAddress"],
    },
  },
  {
    name: "averis_position_status",
    description: "Get the financing position for a job: principal, fee, repayment status, pool address, and whether the position is active, repaid, or in default.",
    requiresAuth: false,
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Job ID as a decimal string" },
      },
      required: ["jobId"],
    },
  },
];

// ── Auth verification (reused from server context) ────────────────────────

const AUTH_TYPES = {
  AgentRequest: [
    { name: "agentAddress", type: "address" },
    { name: "nonce",        type: "uint256" },
    { name: "expiry",       type: "uint256" },
    { name: "chainId",      type: "uint256" },
  ],
};

async function verifyMCPAuth(args, chainId) {
  const { agentAddress, nonce, expiry, signature } = args;
  if (!agentAddress || nonce === undefined || expiry === undefined || !signature) {
    return { ok: false, error: "Auth required: provide agentAddress, nonce, expiry, and signature in tool arguments" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(expiry) < now) {
    return { ok: false, error: "Signature expired" };
  }
  try {
    const recovered = await recoverTypedDataAddress({
      domain: { name: "AverisProtocol", version: "2", chainId: BigInt(chainId) },
      types:  AUTH_TYPES,
      primaryType: "AgentRequest",
      message: {
        agentAddress,
        nonce:   BigInt(nonce),
        expiry:  BigInt(expiry),
        chainId: BigInt(chainId),
      },
      signature,
    });
    if (recovered.toLowerCase() !== agentAddress.toLowerCase()) {
      return { ok: false, error: "Signature does not match agentAddress" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Invalid signature: ${err.message}` };
  }
}

// ── MCP response helpers ──────────────────────────────────────────────────

function mcpOk(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    isError: false,
  };
}

function mcpErr(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// ── Internal fetch helpers (call existing server routes in-process) ────────

async function _callRoute(serverCtx, method, path, body) {
  return new Promise((resolve, reject) => {
    const reqMock = {
      method,
      path,
      params: {},
      body: body || {},
      headers: {},
      verifiedAgent: null,
    };
    const resMock = {
      _status: 200,
      _data: null,
      status(code) { this._status = code; return this; },
      json(data)   { this._data = data; resolve({ status: this._status, data }); return this; },
    };
    try {
      serverCtx.handleRoute(method, path, reqMock, resMock);
    } catch (err) {
      reject(err);
    }
  });
}

// ── Main dispatcher ────────────────────────────────────────────────────────

/**
 * handleMCP — called by the /v1/mcp route in server.mjs
 *
 * @param {object} req   — Express request
 * @param {object} res   — Express response
 * @param {object} ctx   — server context: { chainId, contracts, publicClient, routeHandlers }
 */
export async function handleMCP(req, res, ctx) {
  const { method, params } = req.body || {};

  if (!method) {
    return res.status(400).json(mcpErr("Missing method. Use tools/list or tools/call."));
  }

  // tools/list — return all tool definitions
  if (method === "tools/list") {
    return res.json({
      tools: MCP_TOOLS.map((t) => ({
        name:              t.name,
        description:       t.description,
        inputSchema:       t.inputSchema,
        ...(t["x-requires-auth"] ? { "x-requires-auth": true } : {}),
      })),
    });
  }

  // Unknown method
  if (method !== "tools/call") {
    return res.status(400).json({
      error: `Unknown MCP method: "${method}". Supported methods: tools/list, tools/call.`,
    });
  }

  // tools/call — dispatch to the appropriate handler
  if (method === "tools/call") {
    const { name, arguments: args = {} } = params || {};
    if (!name) return res.json(mcpErr("params.name is required for tools/call"));

    const tool = MCP_TOOLS.find((t) => t.name === name);
    if (!tool) return res.json(mcpErr(`Unknown tool: ${name}. Use tools/list to see available tools.`));

    // Verify auth for protected tools
    if (tool.requiresAuth) {
      const chainId = ctx?.chainId ?? 0;
      if (!args.agentAddress || args.nonce === undefined || args.expiry === undefined || !args.signature) {
        return res.status(401).json(mcpErr("Auth required: provide agentAddress, nonce, expiry, and signature in tool arguments"));
      }
      const authResult = await verifyMCPAuth(args, chainId);
      if (!authResult.ok) return res.status(401).json(mcpErr(authResult.error));
    }

    // Validate required fields before any ctx call
    const toolDef = MCP_TOOLS.find((t) => t.name === name);
    if (toolDef?.inputSchema?.required) {
      for (const field of toolDef.inputSchema.required) {
        if (args[field] === undefined || args[field] === null || args[field] === "") {
          return res.status(400).json(mcpErr(`Missing required field: ${field}`));
        }
      }
    }

    // Guard: some tools need a live server context (chain access).
    // Tools that only need static data (averis_discover) work without ctx.
    const needsCtx = !["averis_discover"].includes(name);
    if (needsCtx && !ctx) {
      return res.status(503).json(mcpErr("Server context unavailable — Averis API server is not running in live mode"));
    }

    try {
      switch (name) {
        case "averis_discover":
          return res.json(mcpOk(ctx ? ctx.discoveryDoc() : { message: "Averis Protocol — working capital for autonomous AI agents", docs: "https://github.com/mosaro0224/averis-protocol" }));

        case "averis_protocol_status": {
          const r = await ctx.fetch("/v2/protocol");
          return res.json(r.ok ? mcpOk(r.data) : mcpErr(r.data?.error || "Failed to fetch protocol status"));
        }

        case "averis_check_eligibility": {
          if (!args.agentAddress) return res.json(mcpErr("agentAddress is required"));
          const r = await ctx.fetch(`/v2/agents/${args.agentAddress}`);
          return res.json(r.ok ? mcpOk(r.data) : mcpErr(r.data?.error || "Failed to check eligibility"));
        }

        case "averis_verify_job": {
          if (!args.protocol || args.jobId === undefined) {
            return res.json(mcpErr("protocol and jobId are required"));
          }
          const r = await ctx.post("/v2/jobs/verify", {
            protocol:        args.protocol,
            jobId:           args.jobId,
            agentAddress:    args.agentAddress,
            requestedAmount: args.requestedAmount,
          });
          return res.json(r.ok ? mcpOk(r.data) : mcpErr(r.data?.error || "Failed to verify job"));
        }

        case "averis_get_quote": {
          if (!args.agentAddress || !args.protocol || args.jobId === undefined || !args.requestedAmount) {
            return res.json(mcpErr("agentAddress, protocol, jobId, and requestedAmount are required"));
          }
          const r = await ctx.post("/v2/credit/quote", {
            agentAddress:    args.agentAddress,
            protocol:        args.protocol,
            jobId:           args.jobId,
            requestedAmount: args.requestedAmount,
          });
          return res.json(r.ok ? mcpOk(r.data) : mcpErr(r.data?.error || "Failed to get quote"));
        }

        case "averis_request_funding": {
          // Auth already verified above. Return the draw() calldata.
          if (!args.agentAddress || !args.protocol || args.jobId === undefined || !args.requestedAmount) {
            return res.json(mcpErr("agentAddress, protocol, jobId, and requestedAmount are required"));
          }
          // Reuse the quote endpoint — draw() is submitted by the agent on-chain.
          const r = await ctx.post("/v2/credit/quote", {
            agentAddress:    args.agentAddress,
            protocol:        args.protocol,
            jobId:           args.jobId,
            requestedAmount: args.requestedAmount,
          });
          if (!r.ok) return res.json(mcpErr(r.data?.error || "Failed to compute funding terms"));
          return res.json(mcpOk({
            ...r.data,
            instruction: "Submit the draw() transaction from your agent wallet using the calldata above. The spending pool will be created atomically.",
          }));
        }

        case "averis_pool_status": {
          if (!args.poolAddress) return res.json(mcpErr("poolAddress is required"));
          const r = await ctx.fetch(`/v2/pools/${args.poolAddress}`);
          return res.json(r.ok ? mcpOk(r.data) : mcpErr(r.data?.error || "Failed to fetch pool"));
        }

        case "averis_position_status": {
          if (args.jobId === undefined) return res.json(mcpErr("jobId is required"));
          const r = await ctx.fetch(`/v2/positions/${args.jobId}`);
          return res.json(r.ok ? mcpOk(r.data) : mcpErr(r.data?.error || "Failed to fetch position"));
        }

        default:
          return res.json(mcpErr(`Unhandled tool: ${name}`));
      }
    } catch (err) {
      return res.json(mcpErr(`Tool execution error: ${err.message}`));
    }
  }

  return res.status(400).json(mcpErr(`Unknown method: ${method}. Use tools/list or tools/call.`));
}
