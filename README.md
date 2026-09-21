# Averis Protocol

Working-capital infrastructure for autonomous AI agents with verified job receivables.

## What it does

Averis finances verified agent jobs on Arc. An agent with a funded escrow job can draw a temporary controlled spending pool to bridge a capital shortfall. The full advance is deployed to the pool — no fee deducted at draw. Principal and fee are repaid automatically from the job receivable at settlement. Any unspent pool balance is swept to the agent at settlement.

- **Advance rate:** up to 40% of job budget (min of advance rate, agent credit limit, protocol maximum, vault liquidity)
- **Financing fee:** 2% of advance (flat, added at repayment — not deducted at draw)
- **Per-agent cap:** 10,000 USDC
- **Protocol maximum:** 50,000 USDC
- **Fee split:** 70% LP / 20% treasury / 10% reserve
- **Example:** Budget 1000, advance 400, fee 8 — agent draws 400 and receives 400 in pool. At settlement: Averis receives 408, agent receives 592 plus any unspent pool balance.

## Live deployment (Arc Testnet)

| Contract | Address |
| --- | --- |
| AverisVault | `0x0c60e6b789286d8d3815ca4760839b3dc50a2967` |
| AverisFinancingV2 | `0x20429b8d5eef0bfbfb1d14eb8b2a1ce94817b36f` |
| AverisACP | `0x230fb4771e32c5f6f2d157131f7976915fc65248` |
| ReceivableRouter | `0x89ff42862307145b92f5c6bf72772140e4bab57a` |
| AverisHood | `0xa37135beeb44a9b0a9c59e552d60935f9babcea0` |
| AverisPoolFactory | `0xff52e6bc002f3facff0317918bfd7e93525fe7ed` |
| AverisAdapterRegistry | `0x5bdaa397a2d24de1e9e6c25f57c475e4c35c2f8b` |
| AverisCredit | `0x0db85a8d55fa1bbb06f34219f72c65f17dbe10d8` |
| AverisReserve | `0x9a025a6b3c31093fe16d60d7b48e527afb24b357` |
| AverisACPAdapter | `0x2ad747c735cec953e3277e7b203b2c5b478da5f1` |

- **Frontend:** https://averisprotocol.xyz
- **API:** https://api.averisprotocol.xyz
- **Chain:** Arc Testnet (chain ID 1227)
- **USDC:** `0x3600000000000000000000000000000000000000`

## Repository layout

- `src/` — Solidity V2 contracts (AverisFinancingV2, AverisHood, AverisReserve, AverisJobPool, AverisPoolFactory, AverisCredit, AverisAdapterRegistry, adapters/)
- `test/` — Foundry tests (68 tests, all passing)
- `script/DeployV2.s.sol` — V2 Arc deployment script
- `api/server.mjs` — V2 Express API with live chain reads
- `api/mcp.mjs` — MCP/1.0 tool dispatcher (9 tools)
- `api/agent-card.json` — Agent capability manifest
- `api/openapi.json` — OpenAPI 3.1 spec
- `scripts/` — Utility scripts (wire.mjs, set-advance-rate.mjs, migrate-vault.mjs)
- `web/` — Static protocol interface (legacy V1 UI)

## Local development

1. Install [Foundry](https://book.getfoundry.sh/getting-started/installation) and [Bun](https://bun.sh).
2. Copy `.env.example` to `.env` and fill in contract addresses and RPC.
3. Run `forge test -vvv` to execute all 68 contract tests.
4. Run `bun install` then `bun start` to start the API on port 3001.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for full details.

## Agent discovery

Agents can discover Averis via:
- `GET https://api.averisprotocol.xyz/.well-known/agent-card.json`
- `GET https://api.averisprotocol.xyz/v1/discover`
- `POST https://api.averisprotocol.xyz/v1/mcp` — MCP/1.0 tool interface
- `GET https://averisprotocol.xyz/llms.txt` — LLM crawler entry point

## Security

Unaudited testnet code. Do not use with real funds until a third-party audit is completed.
Owner: `0x4bAf1e5E3355f37539f423Ba251Dd7f98fE2Ea56` (replace with Gnosis Safe multisig before mainnet).
