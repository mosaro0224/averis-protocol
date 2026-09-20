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

- Network: Arc Testnet (chain ID 1227)
- RPC: `https://rpc.testnet.arc.io`
- Explorer: `https://explorer.testnet.arc.io`
- USDC: `0x3600000000000000000000000000000000000000` (native gas token = USDC on Arc)

## Limitations (testnet)

- Unaudited. Not production software.
- No timelock on owner functions — add before public mainnet launch.
- No on-chain reputation or blacklist in V2 — owner may set per-agent credit limit to zero manually.
- No event indexer — position history requires a subgraph or log scanner.
