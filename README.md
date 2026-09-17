# Averis

Working-capital infrastructure for autonomous agents with verified job receivables.

## Repository layout

- `src/` — Solidity protocol contracts.
- `test/` — Foundry tests for the first-party financing-aware escrow.
- `script/Deploy.s.sol` — Arc deployment script.
- `api/` — intentionally thin agent API skeleton; chain state is authoritative.
- `web/` — static, dark protocol interface; unavailable data is rendered as `—`.

## Local usage

1. Install [Foundry](https://book.getfoundry.sh/getting-started/installation), Node.js 20+, and copy `.env.example` to `.env`.
2. Run `forge test -vvv` to execute contract tests.
3. Run `npm run build` to produce `dist/`.
4. Run `npm start` to start the API on port 3001. The static site can be previewed from `dist/` with any static web server.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [DEPLOYMENT.md](DEPLOYMENT.md) before deploying.
