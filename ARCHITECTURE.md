# Averis V1 architecture

## What is enforceable

`AverisACP` is an Averis-owned ERC-8183-compatible job escrow. Before funding, only the provider can set the provider-side payout receiver. That value is immutable after funding. A financed job must name `ReceivableRouter`; the router accepts settlement only from `AverisACP` and forwards it, in the same settlement transaction, to `AverisFinancing`. Financing sends principal plus the pre-agreed fee to `AverisVault`, then sends any remainder to the provider.

This is a receivable lien, not authority over an agent wallet. The agent receives draw funds directly and grants no unlimited ERC-20 allowance to Averis.

```text
LP -> AverisVault -> AverisFinancing -> provider
job escrow -> ReceivableRouter -> Financing -> vault + provider remainder
```

## Contracts

| Contract | Responsibility |
| --- | --- |
| `AverisVault` | USDC deposits, shares, deployed-principal accounting, liquidity-limited withdrawals. |
| `AverisFinancing` | one job-bound position, deterministic cap, draw, repayment/default accounting. |
| `ReceivableRouter` | immutable payout receiver; accepts settlement only from the configured escrow. |
| `AverisACP` | authoritative ERC-8183-compatible job state, USDC escrow, immutable-at-funding payout receiver, settlement and refund paths. |

`maxAdvance = min(receivable × advance rate, agent cap, protocol cap, vault liquid USDC)`. Parameters are owner-controlled V1 configuration and should be owned by a timelocked multisig in production. No backend address is authorized to lend, withdraw, settle, or redirect funds.

## State and failures

`NONE -> ACTIVE -> REPAID | PARTIALLY_RECOVERED | DEFAULTED | EXPIRED`. Partial settlement repays what exists, with principal before fees. Rejected/cancelled/expired jobs are marked permissionlessly after the adapter reports terminal state. The remaining unpaid principal stays as a vault loss; it is not hidden.

## ERC-8183 and ERC-8004

Arc's deployed ERC-8183 contract does not expose a provider payout receiver in its documented deployed interface, so it cannot enforce this lien. Averis therefore deploys `AverisACP` rather than pretending an after-hook can collect a job receivable. `complete` and `settleClaim` transfer to the immutable receiver and call it in the same transaction; a failing callback reverts settlement. `reject` and `claimRefund` refund the client and leave financing as a transparent default/write-off.

ERC-8004 was not present. V1 uses the provider address as agent identity; ERC-8004 can later enrich display/reputation only, never override on-chain limits.

## Explicit limitations

- This is testnet-oriented code, not audited production software.
- Defaults are accounted for but V1 has no collateral or collection beyond the routed receivable.
- Owner can tune caps/rates and per-agent limits; use a multisig + timelock before public deployment.
- The included mock escrow is solely for tests, never deployment.
