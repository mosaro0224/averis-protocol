# Deployment

## Arc Testnet constants

| Setting | Value |
| --- | --- |
| Chain ID | `1227` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` |

Arc uses USDC for gas. Its native balance uses 18 decimals while the ERC-20 interface uses 6. Protocol amounts always use the ERC-20 interface (6 decimals).

## Deployed contracts (Arc Testnet)

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

Owner: `0x9651265f9f42ed719FFCf865eB4A232e176f7AFD`

## Protocol parameters (current)

| Parameter | Value |
| --- | --- |
| Advance rate | 40% (4000 bps) |
| Financing fee | 2% (200 bps) |
| Per-agent cap | 10,000 USDC |
| Protocol maximum | 50,000 USDC |
| Fee split | 70% LP / 20% treasury / 10% reserve |

## Deploy from scratch (V2)

1. Install [Foundry](https://book.getfoundry.sh/getting-started/installation) and [Bun](https://bun.sh).
2. Run `forge test -vvv` — all 60 tests must pass.
3. Set environment variables:
   ```
   ARC_RPC_URL=https://rpc.testnet.arc.io
   ARC_USDC=0x3600000000000000000000000000000000000000
   ARC_CHAIN_ID=1227
   PRIVATE_KEY=0x...
   ```
4. Run:
   ```sh
   forge script script/DeployV2.s.sol:DeployV2 --rpc-url "$ARC_RPC_URL" --broadcast -vvvv
   ```
5. Copy emitted addresses to `.env`.
6. Run wiring script:
   ```sh
   bun scripts/wire.mjs
   ```
7. Verify wiring with:
   ```sh
   bun scripts/set-advance-rate.mjs 4000
   ```

## Live services

- **Frontend:** https://averisprotocol.xyz (Netlify)
- **API:** https://api.averisprotocol.xyz (Railway)

## API local development

```sh
bun install
bun start       # API on port 3001
```

## Mainnet gate

Do not deploy to mainnet until:
1. Third-party security audit completed
2. Treasury replaced with Gnosis Safe multisig (`setTreasury(safeAddress)`)
3. Owner roles transferred to multisig + timelock
4. Vault seeded with real liquidity
5. All contract addresses re-verified on Arc Mainnet
