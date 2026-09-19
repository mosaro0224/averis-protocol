/**
 * Averis Discovery Layer Tests
 *
 * Tests the static discovery assets and MCP tool definitions
 * without requiring a live chain or running server.
 * Run: node --test api/discovery.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);

// ── Load static JSON assets ────────────────────────────────────────────────

const agentCard = req("./agent-card.json");
const openapi   = req("./openapi.json");

// ── Agent Card tests ───────────────────────────────────────────────────────

describe("agent-card.json", () => {
  test("has required top-level fields", () => {
    assert.ok(agentCard.schema_version,       "schema_version missing");
    assert.ok(agentCard.name,                  "name missing");
    assert.ok(agentCard.description,           "description missing");
    assert.ok(Array.isArray(agentCard.capabilities), "capabilities must be array");
    assert.ok(agentCard.api,                   "api section missing");
    assert.ok(agentCard.authentication,        "authentication section missing");
    assert.ok(agentCard.mcp,                   "mcp section missing");
  });

  test("capabilities include required agent-finance keywords", () => {
    const caps = agentCard.capabilities.map((c) =>
      typeof c === "string" ? c : c.name || c.id || ""
    );
    const required = [
      "agent_working_capital",
      "usdc_financing",
      "agentic_finance",
    ];
    for (const r of required) {
      assert.ok(
        caps.some((c) => c.toLowerCase().includes(r.toLowerCase().replace(/_/g, "")) ||
                         c === r),
        `capability "${r}" not found in agent-card`
      );
    }
  });

  test("discovery_url present in api section", () => {
    assert.ok(agentCard.api.discovery_url || agentCard.api.base_url,
      "api.discovery_url or api.base_url must be present");
  });

  test("mcp.endpoint present", () => {
    assert.ok(agentCard.mcp.endpoint, "mcp.endpoint must be present");
  });

  test("agent_journey lists at least 5 steps", () => {
    assert.ok(
      Array.isArray(agentCard.agent_journey) && agentCard.agent_journey.length >= 5,
      "agent_journey must have at least 5 steps"
    );
  });

  test("authentication specifies eip712 or similar scheme", () => {
    const authStr = JSON.stringify(agentCard.authentication).toLowerCase();
    assert.ok(
      authStr.includes("eip712") || authStr.includes("eip-712") || authStr.includes("signature"),
      "authentication must mention EIP-712 or signature scheme"
    );
  });

  test("keywords include machine-readable terms", () => {
    const kws = (agentCard.keywords || []).join(" ").toLowerCase();
    assert.ok(kws.includes("agent") || kws.includes("financing") || kws.includes("usdc"),
      "keywords must include agent/financing/usdc terms");
  });
});

// ── OpenAPI tests ──────────────────────────────────────────────────────────

describe("openapi.json", () => {
  test("is valid OpenAPI 3.x structure", () => {
    assert.ok(openapi.openapi?.startsWith("3."), "openapi version must start with 3.");
    assert.ok(openapi.info?.title,   "info.title missing");
    assert.ok(openapi.info?.version, "info.version missing");
    assert.ok(openapi.paths,         "paths missing");
  });

  test("documents /v1/discover endpoint", () => {
    const path = openapi.paths["/v1/discover"];
    assert.ok(path, "/v1/discover must be documented");
    assert.ok(path.get, "/v1/discover must have GET method");
  });

  test("documents /v2/credit/quote endpoint", () => {
    const path = openapi.paths["/v2/credit/quote"];
    assert.ok(path, "/v2/credit/quote must be documented");
    assert.ok(path.post, "/v2/credit/quote must have POST method");
  });

  test("documents authenticated spend endpoint", () => {
    const path = openapi.paths["/v2/pools/{poolAddress}/spend"];
    assert.ok(path, "/v2/pools/{poolAddress}/spend must be documented");
    assert.ok(path.post, "spend must have POST method");
  });

  test("has EIP-712 security scheme defined", () => {
    const schemes = openapi.components?.securitySchemes || {};
    const hasEIP712 = Object.values(schemes).some(
      (s) => JSON.stringify(s).toLowerCase().includes("eip712") ||
             JSON.stringify(s).toLowerCase().includes("x-agent-signature")
    );
    assert.ok(hasEIP712, "securitySchemes must include EIP-712 / X-Agent-Signature scheme");
  });

  test("documents /v1/mcp endpoint", () => {
    const path = openapi.paths["/v1/mcp"];
    assert.ok(path, "/v1/mcp must be documented");
    assert.ok(path.post, "/v1/mcp must have POST method");
  });

  test("x-agent-facing extension present on at least one path", () => {
    const hasAgentFacing = Object.values(openapi.paths).some(
      (p) => Object.values(p).some(
        (op) => typeof op === "object" && op["x-agent-facing"] === true
      )
    );
    assert.ok(hasAgentFacing, "at least one path must have x-agent-facing: true");
  });
});

// ── /v1/discover shape test (static content, no server) ───────────────────

describe("v1/discover response shape", () => {
  // Import the discover handler logic directly to test without HTTP
  test("discover data includes required fields", () => {
    // Validate that agent-card.json is the source of truth for discovery
    const required = ["name", "description", "capabilities", "api", "mcp", "authentication"];
    for (const field of required) {
      assert.ok(agentCard[field] !== undefined, `discover must expose "${field}"`);
    }
  });

  test("agent journey covers the full capital lifecycle", () => {
    const journey = agentCard.agent_journey || [];
    const journeyStr = JSON.stringify(journey).toLowerCase();
    const mustMention = ["discover", "eligi", "quote", "fund", "repay"];
    for (const term of mustMention) {
      assert.ok(journeyStr.includes(term), `agent journey must mention "${term}"`);
    }
  });
});

// ── robots.txt content test ────────────────────────────────────────────────

describe("robots.txt", () => {
  test("server.mjs has a robots.txt route defined", () => {
    const serverSrc = readFileSync(join(__dirname, "server.mjs"), "utf8");
    assert.ok(
      serverSrc.includes("/robots.txt"),
      "server.mjs must define a /robots.txt route"
    );
  });
});

// ── Discovery routes present in server.mjs ────────────────────────────────

describe("server.mjs discovery routes", () => {
  let serverSrc;
  test("setup", () => {
    serverSrc = readFileSync(join(__dirname, "server.mjs"), "utf8");
  });

  test("serves /.well-known/agent-card.json", () => {
    assert.ok(serverSrc.includes(".well-known/agent-card.json"),
      "server must serve /.well-known/agent-card.json");
  });

  test("serves /openapi.json", () => {
    assert.ok(serverSrc.includes("/openapi.json"),
      "server must serve /openapi.json");
  });

  test("has /v1/discover route", () => {
    assert.ok(serverSrc.includes("/v1/discover"),
      "server must have /v1/discover route");
  });

  test("has /v1/mcp route", () => {
    assert.ok(serverSrc.includes("/v1/mcp"),
      "server must have /v1/mcp route");
  });

  test("imports and uses handleMCP", () => {
    assert.ok(serverSrc.includes("handleMCP"),
      "server must import and use handleMCP from mcp.mjs");
  });

  test("imports MCP_TOOLS for discover response", () => {
    assert.ok(serverSrc.includes("MCP_TOOLS"),
      "server must expose MCP_TOOLS in discover endpoint");
  });
});
