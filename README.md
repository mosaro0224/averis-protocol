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
| AverisVault | `0xf7F47493E2f042a428a531724bE62854002979cA` |
| AverisFinancingV2 | `0x102eC41EDdeed916012D7B345c42e7Be64AD2051` |
| AverisACP | `0x3477e203fCFFbfe0E419E230d115d7C80A22BB18` |
| ReceivableRouter | `0x0b2C571D2FD5199b758d426340CF8260515eFF15` |
| AverisHood | `0xd7D8633804FfdB3504Ba6F8036b26536f3d89E0a` |
| AverisPoolFactory | `0x69e875801822ffcA3C34022a2E2363d26688259a` |
| AverisAdapterRegistry | `0x0D6DBfaeAf74b45642064E6bA27F02c69872f4B0` |
| AverisCredit | `0x9330790C74E71f16ef568c4CD6ca06662A611dd9` |
| AverisReserve | `0x9069f069467578c1F4B6f2385c6B52Ca86f8DDf5` |
| AverisACPAdapter | `0x8753aE3c8fACf0C352c4b786AF44D8eBF383D62A` |

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
