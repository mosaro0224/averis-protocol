/**
 * Averis MCP Tool Tests
 *
 * Tests MCP tool definitions, schemas, and auth enforcement
 * without requiring a live chain.
 * Run: node --test api/mcp.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MCP_TOOLS, handleMCP } from "./mcp.mjs";

// ── MCP tools/list tests ───────────────────────────────────────────────────

describe("MCP_TOOLS definition", () => {
  test("exports at least 6 tools", () => {
    assert.ok(Array.isArray(MCP_TOOLS), "MCP_TOOLS must be an array");
    assert.ok(MCP_TOOLS.length >= 6, `Expected >= 6 tools, got ${MCP_TOOLS.length}`);
  });

  test("every tool has name, description, and inputSchema", () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(tool.name,        `tool missing name: ${JSON.stringify(tool)}`);
      assert.ok(tool.description, `tool "${tool.name}" missing description`);
      assert.ok(tool.inputSchema, `tool "${tool.name}" missing inputSchema`);
      assert.equal(tool.inputSchema.type, "object",
        `tool "${tool.name}" inputSchema.type must be "object"`);
    }
  });

  test("includes averis_discover tool (no auth)", () => {
    const t = MCP_TOOLS.find((t) => t.name === "averis_discover");
    assert.ok(t, "averis_discover tool must exist");
    assert.ok(!t["x-requires-auth"],
      "averis_discover must not require auth (it's public discovery)");
  });

  test("includes averis_check_eligibility tool (no auth)", () => {
    const t = MCP_TOOLS.find((t) => t.name === "averis_check_eligibility");
    assert.ok(t, "averis_check_eligibility tool must exist");
    assert.ok(!t["x-requires-auth"],
      "averis_check_eligibility must not require auth");
  });

  test("includes averis_get_quote tool (no auth)", () => {
    const t = MCP_TOOLS.find((t) => t.name === "averis_get_quote");
    assert.ok(t, "averis_get_quote tool must exist");
    assert.ok(!t["x-requires-auth"],
      "averis_get_quote must not require auth (read-only)");
  });

  test("includes averis_request_funding tool (requires auth)", () => {
    const t = MCP_TOOLS.find((t) => t.name === "averis_request_funding");
    assert.ok(t, "averis_request_funding tool must exist");
    assert.ok(t["x-requires-auth"],
      "averis_request_funding MUST require auth — it initiates a funding flow");
  });

  test("averis_request_funding inputSchema requires agentAddress and jobId", () => {
    const t = MCP_TOOLS.find((t) => t.name === "averis_request_funding");
    const required = t.inputSchema.required || [];
    assert.ok(required.includes("agentAddress"), "must require agentAddress");
    assert.ok(required.includes("jobId"),        "must require jobId");
    assert.ok(required.includes("requestedAmount"), "must require requestedAmount");
  });

  test("averis_pool_status tool exists", () => {
    const t = MCP_TOOLS.find((t) =>
      t.name === "averis_pool_status" || t.name === "averis_get_pool");
    assert.ok(t, "pool status tool must exist");
  });

  test("averis_position_status tool exists", () => {
    const t = MCP_TOOLS.find((t) =>
      t.name === "averis_position_status" || t.name === "averis_get_position");
    assert.ok(t, "position status tool must exist");
  });

  test("no tool name contains spaces (MCP convention: snake_case)", () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(!tool.name.includes(" "), `tool name "${tool.name}" must not contain spaces`);
    }
  });

  test("all auth-required tools list auth fields in inputSchema", () => {
    const authFields = ["agentAddress", "nonce", "expiry", "signature"];
    for (const tool of MCP_TOOLS.filter((t) => t["x-requires-auth"])) {
      const props = Object.keys(tool.inputSchema.properties || {});
      for (const field of authFields) {
        assert.ok(props.includes(field),
          `auth-required tool "${tool.name}" must have inputSchema property "${field}"`);
      }
    }
  });
});

// ── handleMCP dispatch tests ───────────────────────────────────────────────

describe("handleMCP dispatcher", () => {
  // Helper: build a mock req/res pair and call handleMCP
  function mockReqRes(body) {
    const chunks = [];
    let statusCode = 200;
    const res = {
      status(c) { statusCode = c; return this; },
      json(data) { chunks.push(data); return this; },
      _getStatus() { return statusCode; },
      _getData()   { return chunks[0]; },
    };
    const req = { body };
    return { req, res };
  }

  test("tools/list returns all tools", async () => {
    const { req, res } = mockReqRes({ method: "tools/list", params: {} });
    await handleMCP(req, res, null);
    const data = res._getData();
    assert.ok(data, "handleMCP must respond");
    assert.ok(data.tools || data.result?.tools,
      "tools/list response must include tools array");
    const tools = data.tools || data.result?.tools;
    assert.ok(Array.isArray(tools) && tools.length >= 6,
      "must return >= 6 tools");
  });

  test("tools/list does not require auth", async () => {
    const { req, res } = mockReqRes({ method: "tools/list" });
    await handleMCP(req, res, null);
    // Must not return 401
    assert.notEqual(res._getStatus(), 401, "tools/list must not require auth");
  });

  test("unknown method returns error", async () => {
    const { req, res } = mockReqRes({ method: "invalid/method" });
    await handleMCP(req, res, null);
    const data = res._getData();
    assert.ok(
      data.error || data.result?.isError,
      "unknown MCP method must return error"
    );
  });

  test("tools/call averis_discover succeeds without auth", async () => {
    const { req, res } = mockReqRes({
      method:  "tools/call",
      params:  { name: "averis_discover", arguments: {} },
    });
    await handleMCP(req, res, null);
    const data = res._getData();
    // Should not be a 401
    assert.notEqual(res._getStatus(), 401,
      "averis_discover must succeed without auth");
    assert.ok(data, "must return a response");
  });

  test("tools/call averis_request_funding without auth returns 401 or auth error", async () => {
    const { req, res } = mockReqRes({
      method: "tools/call",
      params: {
        name:      "averis_request_funding",
        arguments: {
          agentAddress:    "0x1234567890123456789012345678901234567890",
          protocol:        "0x1234567890123456789012345678901234567890",
          jobId:           "1",
          requestedAmount: "1000000",
          // deliberately omit nonce, expiry, signature
        },
      },
    });
    await handleMCP(req, res, null);
    const status = res._getStatus();
    const data   = res._getData();
    const isAuthError =
      status === 401 ||
      (data?.error && /auth|signature|missing/i.test(JSON.stringify(data.error)));
    assert.ok(isAuthError,
      `averis_request_funding without auth must return 401 or auth error, got status=${status} data=${JSON.stringify(data)}`);
  });

  test("tools/call with missing required field returns validation error", async () => {
    const { req, res } = mockReqRes({
      method: "tools/call",
      params: {
        name:      "averis_get_quote",
        arguments: {
          // agentAddress omitted intentionally
          protocol: "0x1234567890123456789012345678901234567890",
          jobId:    "1",
          // requestedAmount omitted
        },
      },
    });
    await handleMCP(req, res, null);
    const data = res._getData();
    assert.ok(
      data?.error || data?.result?.isError || res._getStatus() >= 400,
      "missing required fields must produce an error response"
    );
  });

  test("tools/call unknown tool name returns isError", async () => {
    const { req, res } = mockReqRes({
      method: "tools/call",
      params: { name: "nonexistent_tool", arguments: {} },
    });
    await handleMCP(req, res, null);
    const data = res._getData();
    assert.ok(
      data?.result?.isError || data?.error ||
      (data?.content?.[0]?.text && /unknown|not found/i.test(data.content[0].text)),
      "unknown tool must return an error"
    );
  });
});
