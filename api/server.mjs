import { createServer } from "node:http";

const json = (res, status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
const contractsConfigured = Boolean(process.env.AVERIS_FINANCING && process.env.AVERIS_VAULT && process.env.AVERIS_RECEIVABLE_ROUTER);

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") return json(res, 200, { ok: true, chainId: Number(process.env.ARC_CHAIN_ID || 5042002), contractsConfigured });
  if (url.pathname.startsWith("/agent/eligibility/")) return json(res, 503, { error: "Indexer unavailable", detail: "Configure an RPC indexer; chain contracts remain authoritative." });
  if (["/agent/positions", "/agent/history"].includes(url.pathname)) return json(res, 503, { error: "Indexer unavailable", detail: "No off-chain position cache is configured." });
  if (url.pathname === "/agent/finance" && req.method === "POST") return json(res, 501, { error: "Agents submit draw(jobId, amount) directly to the financing contract; this API never lends." });
  json(res, 404, { error: "Not found" });
}).listen(Number(process.env.PORT || 3001), () => console.log("Averis API listening"));
