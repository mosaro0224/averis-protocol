# Agent Economic Passport

The Agent Economic Passport is Averis's non-custodial, cross-chain identity and reputation layer for autonomous AI agents. It is a complement to — not a replacement for — the ERC-8004 onchain identity standard.

## Design Principles

1. **Non-custodial** — no USDC or funds ever held by Passport contracts.
2. **Append-only receipts** — once anchored, economic activity cannot be removed (only the registry owner can add, not overwrite).
3. **EIP-712 policies** — capability commitments are cryptographically signed by the agent's own key.
4. **ERC-8004 linked** — identity is resolved via the canonical IdentityRegistry, not a competing registry.
5. **Truthful empty states** — no fabricated reputation, balances, or scores; all computed from real on-chain and verified off-chain data.
6. **Chain adapters** — all chain-specific RPC calls go through `api/chain-adapters/`, never hardcoded.

---

## Contracts

Deployed on **Robinhood Chain Testnet** (chain ID 46630).

| Contract | Address | Notes |
|---|---|---|
| AgentPolicyRegistry | `0xf7F47493E2f042a428a531724bE62854002979cA` | EIP-712 policy commitments |
| AgentReceiptRegistry | `0x3477e203fCFFbfe0E419E230d115d7C80A22BB18` | Append-only activity receipts |

ERC-8004 IdentityRegistry (same address on all testnets): `0x8004A818BFB912233c491871b3d84c89A494BD9e`

Set Railway env vars:
```
PASSPORT_POLICY_REGISTRY=0xf7F47493E2f042a428a531724bE62854002979cA
PASSPORT_RECEIPT_REGISTRY=0x3477e203fCFFbfe0E419E230d115d7C80A22BB18
PASSPORT_CHAIN_ID=46630
```

Set Cloudflare Pages env vars for the frontend:
```
VITE_PASSPORT_POLICY_REGISTRY=0xf7F47493E2f042a428a531724bE62854002979cA
VITE_PASSPORT_RECEIPT_REGISTRY=0x3477e203fCFFbfe0E419E230d115d7C80A22BB18
```

---

## Onchain Contracts

### AgentPolicyRegistry (`src/passport/AgentPolicyRegistry.sol`)

Stores EIP-712-signed capability policy commitments for agents.

- **Policies are per-agent, versioned, and revocable.** Revoking is irreversible — no admin override.
- **EIP-712 domain is separate** from the Averis financing domain (different name + version) to prevent cross-protocol signature replay.
- **Nonce replay protection** — each agent has an independent nonce; expired or replayed signatures revert.
- **No ownership transfer without acceptance** — two-step transfer (propose + accept).
- **No funds ever held.**

Key functions:
```solidity
commitPolicy(PolicyCommitment calldata commitment, bytes calldata sig) external
revokePolicy(uint256 policyNonce) external
getPolicy(address agent, uint256 policyNonce) external view returns (PolicyRecord memory)
policyCount(address agent) external view returns (uint256)
```

Policy struct:
```solidity
struct PolicyCommitment {
  address agent;
  string  capabilityType;   // e.g. "research", "coding", "api_execution"
  string  policyURI;        // IPFS URI to full policy document
  bytes32 policyHash;       // keccak256 of policy document content
  uint256 nonce;            // agent's current nonce
  uint256 deadline;         // unix timestamp — must be in the future
}
```

### AgentReceiptRegistry (`src/passport/AgentReceiptRegistry.sol`)

Append-only registry of verified economic activity anchored on-chain.

- **Three verification states**: `SELF_REPORTED` (0), `AVERIS_VERIFIED` (1), `EXTERNAL_ATTESTER` (2).
- **Authorized issuers**: only the registry owner or an authorized issuer can anchor Averis-verified or external receipts. Agents can self-report.
- **No raw data onchain** — only IPFS hash of the full receipt document.
- **Append-only** — receipts cannot be modified or deleted after anchoring.

Key functions:
```solidity
issueReceipt(ReceiptData calldata data) external returns (uint256 receiptId)
authorizeIssuer(address issuer) external onlyOwner
revokeIssuer(address issuer) external onlyOwner
getReceipt(uint256 receiptId) external view returns (ReceiptRecord memory)
getAgentReceipts(address agent) external view returns (uint256[] memory)
```

Receipt struct:
```solidity
struct ReceiptData {
  address agent;
  VerificationState verificationState;
  string  activityType;     // e.g. "job_completion", "usdc_payment"
  bytes32 dataHash;         // keccak256 of off-chain receipt document (IPFS)
  uint256 amount;           // USDC amount in raw units (6 decimals), 0 if N/A
  uint256 timestamp;
  string  chain;            // "arc_testnet" | "rh_testnet" | "ethereum_sepolia"
}
```

---

## API Layer

Base URL: `https://api.averisprotocol.xyz/v2/agents/:address`

Implemented in `api/passport.mjs` (service layer) + `api/passport-store.mjs` (persistent JSON store at `/data/passport-store.json`) + `api/chain-adapters/` (chain-specific RPC).

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v2/agents/:address/passport` | No | Full passport view |
| GET | `/v2/agents/:address/identity` | No | ERC-8004 identity resolution |
| GET | `/v2/agents/:address/policies` | No | All policy commitments |
| POST | `/v2/agents/:address/policies` | EIP-712 | Commit a new policy |
| GET | `/v2/agents/:address/receipts` | No | Activity receipts |
| GET | `/v2/agents/:address/reputation` | No | Computed reputation score |
| GET | `/v2/agents/:address/risk` | No | Risk assessment |
| GET | `/v2/agents/:address/agreements` | No | Agreement history stub |
| GET | `/v2/agents/:address/chains` | No | Cross-chain profile |
| GET | `/v2/agents/:address/counterparties` | No | Counterparty relationships |
| GET | `/v2/agents/:address/transactions` | No | Transaction history |
| GET | `/v2/agents/:address/capabilities` | No | Declared capabilities |
| GET | `/v2/agents/:address/authorization` | No | Authorization status |

### Authentication for POST

POST `/v2/agents/:address/policies` requires EIP-712 signature in `X-Agent-Signature` header:
```
Domain: { name: "AverisPassport", version: "1", chainId: 46630 }
PrimaryType: PolicyRequest
Types: { PolicyRequest: [
  { name: "agent", type: "address" },
  { name: "capabilityType", type: "string" },
  { name: "policyHash", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" }
]}
```

---

## MCP Tools

Exposed at `https://api.averisprotocol.xyz/v1/mcp` alongside existing Averis tools.

Implemented in `api/mcp-passport.mjs`.

| Tool | Auth | Description |
|---|---|---|
| `passport_get` | No | Full passport |
| `passport_policies_list` | No | Policy commitments |
| `passport_receipts_list` | No | Verified receipts |
| `passport_reputation` | No | Reputation score |
| `passport_risk` | No | Risk metrics |
| `passport_policy_commit` | EIP-712 | Commit a new policy |

---

## Frontend

New top-level product surface alongside the existing Averis Bank app.

- `Root.tsx` provides a **BANK | PASSPORT** switcher (stored in localStorage).
- Nav includes a **PASSPORT** button on both Landing and App views.
- `PassportShell.tsx` is the shell with 12 sub-tabs.

### Sub-tabs

| Tab | Component | Description |
|---|---|---|
| Overview | PassportOverview | Stats, score, recent activity |
| Identity | PassportIdentity | ERC-8004 info, wallet, ownership |
| Policies | PassportPolicies | Policy commitments |
| Receipts | PassportReceipts | Verified receipts |
| Reputation | PassportReputation | Score breakdown |
| Risk | PassportRisk | Risk metrics |
| Agreements | PassportAgreements | Agreement history |
| Chains | PassportChains | Cross-chain profile |
| Counterparties | PassportCounterparties | Counterparty list |
| Transactions | PassportTransactions | Transaction history |
| Capabilities | PassportCapabilities | Declared capabilities |
| Authorization | PassportAuthorization | Authorization status |
| MCP | PassportMCP | MCP usage guide |

---

## File Map

```
contracts/
  src/passport/
    AgentPolicyRegistry.sol
    AgentReceiptRegistry.sol
  src/interfaces/
    IAgentPassport.sol
    IAgentReputation.sol
    IAgentAgreementRegistry.sol
    IAgentRiskRegistry.sol
  test/
    AgentPolicyRegistry.t.sol   (21 tests)
    AgentReceiptRegistry.t.sol  (20 tests)
  script/
    DeployPassport.s.sol        (RH Testnet)
    DeployPassportArc.s.sol     (Arc Testnet)

api/
  passport.mjs                  (service layer — all v2/agents routes)
  passport-store.mjs            (persistent JSON store)
  mcp-passport.mjs              (MCP tool handlers)
  chain-adapters/
    rh-testnet.mjs              (RH Testnet RPC + contract calls)
    arc-testnet.mjs             (Arc Testnet RPC + contract calls)

web/src/
  lib/passportConstants.ts      (chain config, contract addresses)
  hooks/usePassport.ts          (passport data hook)
  components/passport/
    PassportShell.tsx           (shell + nav)
    PassportNav.tsx             (sub-tab nav)
    PassportOverview.tsx
    PassportIdentity.tsx
    PassportPolicies.tsx
    PassportReceipts.tsx
    PassportReputation.tsx
    PassportRisk.tsx
    PassportAgreements.tsx
    PassportChains.tsx
    PassportCounterparties.tsx
    PassportTransactions.tsx
    PassportCapabilities.tsx
    PassportAuthorization.tsx
    PassportMCP.tsx
```

---

## Deployment Checklist

- [x] Get ETH on RH Testnet — sent by owner to `0x4bAf1e5E3355f37539f423Ba251Dd7f98fE2Ea56`
- [x] Deploy to RH Testnet — commit `b29173c`, broadcast recorded in `broadcast/DeployPassport.s.sol/46630/run-latest.json`
- [x] `api/agent-card.json` updated with confirmed addresses
- [x] `PASSPORT.md` updated with confirmed addresses
- [ ] Add to Railway: `PASSPORT_POLICY_REGISTRY=0xf7F47493E2f042a428a531724bE62854002979cA`, `PASSPORT_RECEIPT_REGISTRY=0x3477e203fCFFbfe0E419E230d115d7C80A22BB18`, `PASSPORT_CHAIN_ID=46630`
- [ ] Add to Cloudflare Pages: `VITE_PASSPORT_POLICY_REGISTRY=0xf7F47493E2f042a428a531724bE62854002979cA`, `VITE_PASSPORT_RECEIPT_REGISTRY=0x3477e203fCFFbfe0E419E230d115d7C80A22BB18`
- [ ] (Optional) Deploy to Arc Testnet with `script/DeployPassportArc.s.sol` if cross-chain passport needed
