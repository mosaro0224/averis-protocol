#!/usr/bin/env node
/**
 * Averis V2 — post-deploy wiring script
 *
 * Calls all 5 owner-only setup functions in the correct order so the protocol
 * is fully operational after deployment.
 *
 * Usage:
 *   PRIVATE_KEY=0x... node scripts/wire.mjs
 *   # or with a .env file:
 *   cp .env.example .env   # fill in PRIVATE_KEY + contract addresses
 *   node scripts/wire.mjs
 *
 * Prerequisites:
 *   bun add viem   (or: npm install viem)
 *
 * Calls made (in order):
 *   1. AverisVault.setFinancing(financing)
 *   2. ReceivableRouter.setFinancing(financing)
 *   3. AverisPoolFactory.setFinancing(financing)
 *   4. AverisHood.setFinancing(financing)
 *   5. AverisAdapterRegistry.registerAdapter(acp, NATIVE=0, acpAdapter, 0, "AverisACP Native")
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ─── load .env if present ─────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '..', '.env')
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

// ─── config ───────────────────────────────────────────────────────────────────
const REQUIRED = [
  'PRIVATE_KEY',
  'AVERIS_VAULT',
  'AVERIS_FINANCING',
  'AVERIS_ACP',
  'AVERIS_ROUTER',
  'AVERIS_HOOD',
  'AVERIS_FACTORY',
  'AVERIS_REGISTRY',
  'AVERIS_ACP_ADAPTER',
]

const missing = REQUIRED.filter(k => !process.env[k])
if (missing.length) {
  console.error('Missing required env vars:', missing.join(', '))
  console.error('Copy .env.example → .env and fill in the values.')
  process.exit(1)
}

const RPC_URL    = process.env.ARC_RPC_URL    || 'https://rpc.testnet.arc.io'
const CHAIN_ID   = Number(process.env.ARC_CHAIN_ID || '1227')
const PK         = process.env.PRIVATE_KEY

const VAULT      = process.env.AVERIS_VAULT
const FINANCING  = process.env.AVERIS_FINANCING
const ACP        = process.env.AVERIS_ACP
const ROUTER     = process.env.AVERIS_ROUTER
const HOOD       = process.env.AVERIS_HOOD
const FACTORY    = process.env.AVERIS_FACTORY
const REGISTRY   = process.env.AVERIS_REGISTRY
const ACP_ADAPTER = process.env.AVERIS_ACP_ADAPTER

// ─── ABIs (minimal) ───────────────────────────────────────────────────────────
const SET_FINANCING_ABI = parseAbi([
  'function setFinancing(address financing_) external',
])
const REGISTER_ADAPTER_ABI = parseAbi([
  'function registerAdapter(address protocol, uint256 adapterId, address adapter, uint8 tier, string calldata name_) external',
])
const OWNER_ABI = parseAbi([
  'function owner() external view returns (address)',
  'function financing() external view returns (address)',
])

// ─── chain definition ─────────────────────────────────────────────────────────
const arcTestnet = {
  id:   CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

// ─── clients ──────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PK)
const wallet  = createWalletClient({ account, chain: arcTestnet, transport: http(RPC_URL) })
const reader  = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) })

console.log(`\nAveris V2 — Wiring Script`)
console.log(`Chain:    Arc Testnet (${CHAIN_ID})`)
console.log(`Signer:   ${account.address}`)
console.log(`RPC:      ${RPC_URL}\n`)

// ─── helpers ──────────────────────────────────────────────────────────────────
async function send(label, address, abi, functionName, args) {
  process.stdout.write(`  ${label}... `)
  try {
    const hash = await wallet.writeContract({ address, abi, functionName, args })
    const receipt = await reader.waitForTransactionReceipt({ hash })
    if (receipt.status === 'success') {
      console.log(`✓  tx: ${hash}`)
    } else {
      console.log(`✗  REVERTED  tx: ${hash}`)
      process.exitCode = 1
    }
    return receipt
  } catch (err) {
    console.log(`✗  ERROR: ${err.shortMessage || err.message}`)
    process.exitCode = 1
  }
}

async function check(label, address, abi, functionName, args, expected) {
  const result = await reader.readContract({ address, abi, functionName, args })
  const ok = result.toLowerCase() === expected.toLowerCase()
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${result}`)
  if (!ok) process.exitCode = 1
}

// ─── pre-flight checks ────────────────────────────────────────────────────────
console.log('Pre-flight checks...')
for (const [name, addr] of [
  ['AverisVault',           VAULT],
  ['AverisFinancingV2',     FINANCING],
  ['AverisACP',             ACP],
  ['ReceivableRouter',      ROUTER],
  ['AverisHood',            HOOD],
  ['AverisPoolFactory',     FACTORY],
  ['AverisAdapterRegistry', REGISTRY],
  ['AverisACPAdapter',      ACP_ADAPTER],
]) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    console.error(`  ✗ Invalid address for ${name}: ${addr}`)
    process.exit(1)
  }
  console.log(`  ✓ ${name}: ${addr}`)
}

// check signer owns the vault
let vaultOwner
try {
  vaultOwner = await reader.readContract({ address: VAULT, abi: OWNER_ABI, functionName: 'owner' })
} catch {
  console.error('  ✗ Could not read vault owner — is the RPC reachable?')
  process.exit(1)
}
if (vaultOwner.toLowerCase() !== account.address.toLowerCase()) {
  console.error(`\n  ✗ Signer ${account.address} is NOT the vault owner (${vaultOwner}).`)
  console.error('    Use the private key of the deployer / owner wallet.')
  process.exit(1)
}
console.log(`  ✓ Signer is vault owner\n`)

// ─── wiring calls ─────────────────────────────────────────────────────────────
console.log('Wiring contracts...\n')

await send(
  'AverisVault.setFinancing(financing)',
  VAULT, SET_FINANCING_ABI, 'setFinancing', [FINANCING]
)

await send(
  'ReceivableRouter.setFinancing(financing)',
  ROUTER, SET_FINANCING_ABI, 'setFinancing', [FINANCING]
)

await send(
  'AverisPoolFactory.setFinancing(financing)',
  FACTORY, SET_FINANCING_ABI, 'setFinancing', [FINANCING]
)

await send(
  'AverisHood.setFinancing(financing)',
  HOOD, SET_FINANCING_ABI, 'setFinancing', [FINANCING]
)

await send(
  'AverisAdapterRegistry.registerAdapter(acp, NATIVE, acpAdapter)',
  REGISTRY, REGISTER_ADAPTER_ABI, 'registerAdapter',
  [ACP, 0n, ACP_ADAPTER, 0, 'AverisACP Native']
)

// ─── post-wire verification ───────────────────────────────────────────────────
if (process.exitCode === 1) {
  console.log('\n⚠  One or more wiring calls failed. Check the errors above.')
  process.exit(1)
}

console.log('\nVerifying wiring...\n')
await check('Vault.financing',   VAULT,   OWNER_ABI, 'financing', [], FINANCING)
await check('Router.financing',  ROUTER,  OWNER_ABI, 'financing', [], FINANCING)
await check('Factory.financing', FACTORY, OWNER_ABI, 'financing', [], FINANCING)
await check('Hood.financing',    HOOD,    OWNER_ABI, 'financing', [], FINANCING)

console.log('\n✓ Averis V2 is fully wired and operational.\n')
console.log('Next steps:')
console.log('  1. Deposit USDC into AverisVault to provide liquidity')
console.log('  2. Create a job via AverisACP and test a full draw cycle')
console.log('  3. Set a credit limit:  AverisFinancingV2.setCreditLimit(agentAddr, amount)')
console.log('  4. Before mainnet: replace treasury with a Gnosis Safe multisig')
console.log(`     AverisFinancingV2.setTreasury(newMultisigAddress)\n`)
