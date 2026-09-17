# Deployment

## Arc Testnet constants

| Setting | Value |
| --- | --- |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` |

Arc uses USDC for gas. Its native balance uses 18 decimals while the ERC-20 interface uses 6; protocol amounts use the ERC-20 interface only.

## Deploy contracts

1. Install Foundry and fund the deployer with test USDC from Circle’s faucet.
2. Run `forge test -vvv`; all tests must pass. Averis deploys its own `AverisACP` escrow; do not deploy `MockReceivableEscrow`.
3. Set `ARC_RPC_URL`, `ARC_USDC`, `PROTOCOL_MAX_USDC`, and `PRIVATE_KEY` in your shell (never commit the key).
5. Run:

```sh
forge script script/Deploy.s.sol:Deploy --rpc-url "$ARC_RPC_URL" --broadcast -vvvv
```

6. Record the emitted vault, ACP escrow, financing, and router addresses plus transaction hashes in `.env`, then verify source and ownership/parameters on Arcscan.
7. Transfer owner roles to a multisig before accepting deposits. V1 lacks a timelock: add one before a public launch.

## Publish for multiple users

1. Set public frontend variables with the verified contract addresses and Arc RPC; add real contract reads/writes using an audited EIP-1193/Viem integration before enabling action buttons.
2. Build: `npm run build`. Deploy `dist/` to Cloudflare Pages or Vercel. Set the build command to `npm run build` and publish directory to `dist`.
3. Deploy `api/server.mjs` to a Node host (Render, Fly.io, Railway, or a container service). Set `PORT`, RPC URL, chain ID, and deployment addresses as host secrets.
4. Put the API behind HTTPS on `api.your-domain.com`; put the frontend at `app.your-domain.com`; configure CORS only for that app domain once an indexer is implemented.
5. Configure monitoring for RPC health, router settlement events, position defaults, vault liquidity, and API uptime. Back up indexed data; do not treat it as authoritative.
6. Execute an end-to-end test with negligible test USDC: LP deposit → funded router-bound job → provider draw → escrow settlement → verify vault repayment and provider remainder.

## Mainnet gate

Do not launch with real user funds until the escrow adapter, contracts, parameter governance, frontend transaction integration, and monitoring have had professional security review/audit. Arc mainnet addresses and configuration must be re-verified against official documentation at that time.
