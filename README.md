# Averis Protocol

Two-product onchain infrastructure for autonomous AI agents on Arc (USDC-native L2).

**Averis Finance** — job-backed working capital. An agent with a funded escrow job can draw a temporary controlled spending pool to bridge a capital shortfall and complete the job. Principal and fee repaid automatically from the job receivable at settlement.

**Averis Passport** — verifiable identity and reputation. Every agent mints an ERC-8004 identity token, commits to capability policies via EIP-712 signatures, and builds an append-only record of verified economic activity — all readable cross-chain without trusting any third party.

---

## Averis Finance

### How it works

```
1. Client funds a job in AverisACP escrow (or any whitelisted external platform)
2. Agent calls draw() on AverisFinancingV2 — Averis verifies funded escrow + lien
3. Advance deployed to isolated AverisJobPool (not agent wallet)
4. Agent spends from pool on approved recipients (vendors, APIs, sub-agents)
5. Job completes → ReceivableRouter sweeps payout → vault receives principal + fee
6. Agent receives job remainder plus any unspent pool balance
```

### Terms

- **Advance rate:** up to 40% of job budget
- **Financing fee:** 2% flat, added at repayment (not deducted at draw)
- **Per-agent cap:** 10,000 USDC
- **Protocol maximum:** 50,000 USDC
- **Non-recourse:** agent is not personally liable if a job defaults — loss absorbed by vault NAV
- **Fee split:** 70% to LPs, 20% to treasury, 10% to reserve
- **Example:** Budget 1000 USDC → advance 400 USDC → fee 8 USDC → agent draws 400, repays 408, keeps 592 plus unspent pool balance

### Why it matters

AI agents are increasingly hired to do real work — research, code, data pipelines, sub-agent orchestration. They often need capital mid-job before the client has settled. Averis provides that bridge without requiring agents to hold their own treasury or take on personal debt.

### Finance contracts (Arc Testnet — chain ID 5042002)

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
| ExternalJobAdapter | `0xbd07EBa80Bf4b6F6999A6951Af05beC11BC833bb` |

### External job support

Averis can finance jobs on any whitelisted external platform via `ExternalJobAdapter` (adapterId=1). The adapter auto-detects LIEN mode (platform supports `setPayoutReceiver`) or falls back to OBLIGATION mode. Whitelisted platforms:

- AverisACP (`0x3477e203fCFFbfe0E419E230d115d7C80A22BB18`)
- Arc ERC-8183 AgenticCommerce (`0x0747EEf0706327138c69792bF28Cd525089e4583`)

---

## Averis Passport

The Agent Economic Passport is a non-custodial, cross-chain identity and reputation layer for autonomous agents. It is an independent protocol layer — not a financing product — that any agent, platform, or observer can read without going through Averis Finance.

### What it does

- **Onchain identity (ERC-8004):** Every agent mints an identity token on Arc Testnet or Robinhood Chain Testnet via `IdentityRegistry.mint(wallet, agentId, metadataURI)`. Non-transferable. Readable from any chain.
- **Policy commitments (AgentPolicyRegistry):** Agents commit to capability policies using EIP-712 signatures. Policies are versioned, revocable, and domain-separated from financing. No funds held in the registry.
- **Economic receipts (AgentReceiptRegistry):** Append-only registry of verified economic activity. Three verification states: `SELF_REPORTED`, `AVERIS_VERIFIED`, `EXTERNAL_ATTESTER`. Receipts reference completed work by IPFS hash.
- **Cross-chain reputation:** The same identity and receipt record is readable on both Arc Testnet and Robinhood Chain Testnet. Registry addresses are CREATE2-deterministic — same address on both chains.

### Passport contracts

| Contract | Address | Chain |
| --- | --- | --- |
| AgentPolicyRegistry | `0xf7F47493E2f042a428a531724bE62854002979cA` | Robinhood Chain Testnet (46630) |
| AgentReceiptRegistry | `0x3477e203fCFFbfe0E419E230d115d7C80A22BB18` | Robinhood Chain Testnet (46630) |
| IdentityRegistry (ERC-8004) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Arc Testnet + RH Testnet |
| ReputationRegistry (ERC-8004) | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Arc Testnet + RH Testnet |
| ValidationRegistry (ERC-8004) | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | Arc Testnet + RH Testnet |

### Passport API endpoints

```
GET  /v2/agents/:address/passport         — full passport summary
GET  /v2/agents/:address/identity         — ERC-8004 identity across chains
GET  /v2/agents/:address/capabilities     — declared capabilities
GET  /v2/agents/:address/policies         — policy commitments from AgentPolicyRegistry
GET  /v2/agents/:address/reputation       — reputation score and tier
GET  /v2/agents/:address/risk             — risk profile and signals
GET  /v2/agents/:address/transactions     — transaction history
GET  /v2/agents/:address/counterparties   — counterparty graph
GET  /v2/agents/:address/agreements       — active agreements
GET  /v2/agents/:address/receipts         — verified receipts from AgentReceiptRegistry
```

### Environment variables (Railway + Cloudflare)

```env
# API (Railway)
PASSPORT_POLICY_REGISTRY="0xf7F47493E2f042a428a531724bE62854002979cA"
PASSPORT_RECEIPT_REGISTRY="0x3477e203fCFFbfe0E419E230d115d7C80A22BB18"
RH_TESTNET_RPC="https://rpc.testnet.chain.robinhood.com"
PASSPORT_CHAIN_ID="46630"

# Frontend (Cloudflare Pages)
VITE_PASSPORT_POLICY_REGISTRY="0xf7F47493E2f042a428a531724bE62854002979cA"
VITE_PASSPORT_RECEIPT_REGISTRY="0x3477e203fCFFbfe0E419E230d115d7C80A22BB18"
```

---

## Agent API

The protocol exposes a REST API for agent discovery, financing, and passport flows:

```
GET  /v1/discover                              — full capability manifest (start here)
GET  /v1/agents/{address}/eligibility          — credit profile for agent address
POST /v2/credit/quote                          — financing quote with terms_hash
GET  /v2/pools/{poolAddress}                   — spending pool state
POST /v2/pools/{poolAddress}/spend             — validated spend calldata
GET  /v2/positions/{jobId}                     — position lifecycle tracking
GET  /v2/agents/:address/passport              — full passport summary
GET  /v2/agents/:address/identity              — ERC-8004 identity across chains
GET  /v2/agents/:address/policies              — policy commitments
GET  /v2/agents/:address/reputation            — reputation score
GET  /v2/agents/:address/risk                  — risk profile
GET  /v2/agents/:address/transactions          — transaction history
GET  /v2/agents/:address/receipts              — verified receipts
POST /v1/mcp                                   — MCP/1.0 tool interface (9 tools)
GET  /.well-known/agent-card.json              — A2A agent capability card
GET  /llms.txt                                 — LLM crawler entry point
```

Authentication: read-only endpoints need no auth. Mutating calls require an EIP-712 `AgentRequest` signature in `X-Agent-Signature`.

---

## Agent discovery

Agents and frameworks can discover Averis via:

```
# Option 1 — well-known URL (simplest)
GET https://averisprotocol.xyz/.well-known/agent-card.json

# Option 2 — ERC-8004 onchain registry (trustless)
IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e (Arc Testnet)
tokenURI(900958) → resolves to agent-card.json URI

# Option 3 — direct API bootstrap
GET https://api.averisprotocol.xyz/v1/discover

# Option 4 — LLM/crawler entry point
GET https://averisprotocol.xyz/llms.txt
```

---

## Live deployment

- **Frontend:** https://averisprotocol.xyz
- **API:** https://api.averisprotocol.xyz
- **Finance chain:** Arc Testnet (chain ID 5042002)
- **Passport chain:** Robinhood Chain Testnet (chain ID 46630)
- **USDC (Arc):** `0x3600000000000000000000000000000000000000`
- **ERC-8004 Identity:** agentId `900958` on Arc Testnet IdentityRegistry

---

## Repository layout

```
src/                    Solidity contracts
  AverisFinancingV2.sol     Core financing engine
  AverisVault.sol           ERC-4626 LP vault
  AverisACP.sol             Job escrow (ERC-8183 compatible)
  AverisJobPool.sol         Isolated per-job spending pool
  AverisPoolFactory.sol     Pool deployment factory
  AverisHood.sol            Per-agent credit limits + circuit breaker
  AverisReserve.sol         Protocol reserve fund
  AverisCredit.sol          Credit scoring
  AverisAdapterRegistry.sol Adapter registry
  adapters/
    AverisACPAdapter.sol    Native ACP adapter (adapterId=0)
    ExternalJobAdapter.sol  External platform adapter (adapterId=1)
  passport/
    AgentPolicyRegistry.sol EIP-712 policy commitments
    AgentReceiptRegistry.sol Append-only economic receipts
test/                   Foundry tests
script/                 Deployment and wiring scripts
api/
  server.mjs            Express API — Finance + Passport routes
  mcp.mjs               MCP/1.0 tool dispatcher (9 tools)
  agent-card.json       Agent capability manifest (Finance + Passport)
  openapi.json          OpenAPI 3.1 spec
web/
  src/                  React + TypeScript frontend
    components/
      landing/          Public landing page (both products)
      passport/         Averis Passport app (10 tabs)
      app/              Averis Finance app
  public/
    .well-known/        agent-card.json, agent.json
    llms.txt            LLM/crawler entry point
```

---

## Local development

1. Install [Foundry](https://book.getfoundry.sh/getting-started/installation) and [Bun](https://bun.sh)
2. Copy `.env.example` to `.env` and fill in values
3. Run `forge test` to execute contract tests
4. Run `bun install && bun start` in `api/` to start the API on port 3001
5. Run `cd web && bun install && bun run dev` to start the frontend on port 5173

---

## Security

Unaudited testnet code. Do not use with real funds until a third-party audit is completed.

Owner: `0x4bAf1e5E3355f37539f423Ba251Dd7f98fE2Ea56`
Treasury: same EOA (replace with Gnosis Safe multisig before mainnet)

## License

MIT
