# Averis V2 Architecture

## Overview

Averis is working-capital infrastructure for autonomous AI agents. It finances verified job receivables: an agent with a funded escrow job can draw a temporary controlled spending pool, and principal plus fee are repaid automatically when the job settles.

```
LP → AverisVault → AverisFinancingV2 → AverisJobPool → agent spends
job escrow → ReceivableRouter → AverisFinancingV2 → vault repaid + agent remainder
```

## Contracts

| Contract | Responsibility |
| --- | --- |
| `AverisVault` | ERC-4626 USDC vault. LP deposits, shares, deployed-principal accounting, liquidity-limited withdrawals. |
| `AverisFinancingV2` | Core financing engine. Position lifecycle (NONE→ACTIVE→REPAID/DEFAULTED/EXPIRED). draw(), repayment, fee split. |
| `AverisJobPool` | Per-position controlled spending pool. Allowlisted recipients, per-tx cap, expiry, freeze. |
| `AverisPoolFactory` | CREATE2 factory for deterministic pool addresses. |
| `AverisHood` | Exposure controller and circuit breaker. Per-agent cap, total cap, concentration limit, pause. |
| `AverisCredit` | Modular credit engine. Per-agent credit limits, custom overrides. |
| `AverisReserve` | On-chain fee accumulator for the reserve slice (10% of fees). |
| `AverisAdapterRegistry` | Owner-managed registry of external job protocol adapters (NATIVE / VERIFIED / ATTESTED tiers). |
| `ReceivableRouter` | Immutable payout receiver. Accepts settlement only from registered protocols, routes repayment. |
| `AverisACP` | Native ERC-8183-compatible job escrow. Immutable-at-funding payout receiver, settlement and refund paths. |
| `AverisACPAdapter` | IJobAdapter for AverisACP — LIEN mode, automatic repayment via ReceivableRouter. Registered as adapterId=0. |
| `ExternalJobAdapter` | IJobAdapter for jobs on owner-whitelisted external platforms. Reads job state via IExternalJob interface, prefers LIEN mode, falls back to OBLIGATION. Registered as adapterId=1. |

## Adapter tiers

| Tier | Description |
| --- | --- |
| NATIVE | AverisACP — full on-chain lien, automatic repayment via ReceivableRouter |
| VERIFIED | ERC-8183 / generic escrow with verifiable payout receiver |
| ATTESTED | No escrow — EIP-712 repayment obligation, manual repayObligation() call required |

## Advance calculation

```
maxAdvance = min(
  jobBudget × advanceRateBps / 10000,   // 40% of budget
  agentCreditLimit,                      // per-agent cap (default 10,000 USDC)
  protocolMaximum,                       // 50,000 USDC
  vaultAvailableLiquidity
)
```

## Fee split

- 70% → LP vault (increases share value)
- 20% → treasury
- 10% → AverisReserve accumulator

## Position lifecycle

```
NONE → ACTIVE → REPAID
               → DEFAULTED
               → EXPIRED
               → PARTIALLY_RECOVERED
```

- **ACTIVE:** pool created, agent spending
- **REPAID:** full principal + fee returned to vault
- **DEFAULTED:** job rejected or expired, loss written off against vault NAV
- **PARTIALLY_RECOVERED:** partial settlement, remainder written off
- **EXPIRED:** position expired before settlement

## Security model

- No backend address is authorized to lend, withdraw, settle, or redirect funds
- All limits enforced on-chain by AverisHood
- Spending pools are agent-controlled but recipient-allowlisted
- Owner controls: advance rate, fee, caps, pause (use multisig + timelock in production)
- Agent is NOT personally liable on default — financing is non-recourse, secured only by the job receivable

## Chain

- Network: Arc Testnet (chain ID 5042002)
- RPC: `https://rpc.testnet.arc.io`
- Explorer: `https://explorer.testnet.arc.io`
- USDC: `0x3600000000000000000000000000000000000000` (native gas token = USDC on Arc)

## Deployed addresses (2026-09-21)

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

Owner: `0x4bAf1e5E3355f37539f423Ba251Dd7f98fE2Ea56`

## terms_hash verification guide

The owner can adjust `advanceRateBps`, `feeBps`, and `protocolMaximum` at any time.
To protect against rate changes between quote and draw, `/v2/credit/quote` returns:

```json
{
  "terms_hash": "0xabc...",
  "quoted_at_block": 1234567,
  "expires_at_block": 1235167
}
```

`terms_hash = keccak256(abi.encode(advanceRateBps, feeBps, protocolMaximum))` at quote time.

**Before calling `draw()`**, an agent should:
1. Read `advanceRateBps`, `feeBps`, `protocolMaximum` from `AverisFinancingV2`
2. Compute `keccak256(abi.encode(...))` locally
3. Compare with `terms_hash` from the quote
4. Abort and re-quote if they differ
5. Confirm current block < `expires_at_block` (~5 minute window)

## Limitations (testnet)

- Unaudited. Not production software.
- No timelock on owner functions — add before public mainnet launch.
- No on-chain reputation or blacklist — owner may set per-agent credit limit to zero manually.
- No event indexer — position history requires a subgraph or log scanner.
- ExternalJobAdapter platforms must be whitelisted by owner via `setPlatform(address, true)`.
