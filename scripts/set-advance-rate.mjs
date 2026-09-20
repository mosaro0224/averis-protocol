#!/usr/bin/env node
/**
 * Averis Protocol — Set Advance Rate
 * Calls AverisFinancingV2.setAdvanceRateBps(newRate) from the owner wallet.
 * Usage: node scripts/set-advance-rate.mjs [bps]
 * Example: node scripts/set-advance-rate.mjs 4000   ← sets to 40%
 */

import { createWalletClient, createPublicClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env manually
try {
  const env = readFileSync(resolve(__dirname, '../.env'), 'utf8')
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && v.length) process.env[k.trim()] = v.join('=').trim()
  }
} catch {}

const PRIVATE_KEY        = process.env.PRIVATE_KEY
const RPC_URL            = process.env.ARC_RPC_URL   || 'https://rpc.testnet.arc.io'
const CHAIN_ID           = Number(process.env.ARC_CHAIN_ID || 1227)
const FINANCING_ADDRESS  = process.env.AVERIS_FINANCING || '0x20429b8d5eef0bfbfb1d14eb8b2a1ce94817b36f'

if (!PRIVATE_KEY) {
  console.error('\nMissing PRIVATE_KEY in .env\n')
  process.exit(1)
}

const newRateBps = Number(process.argv[2] ?? 4000)
if (isNaN(newRateBps) || newRateBps < 0 || newRateBps > 10000) {
  console.error('\nInvalid rate. Must be 0–10000 bps (e.g. 4000 = 40%).\n')
  process.exit(1)
}

const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

const ABI = [
  { name: 'advanceRateBps',    type: 'function', stateMutability: 'view',       inputs: [],                                       outputs: [{ type: 'uint16' }] },
  { name: 'setAdvanceRateBps', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bps', type: 'uint16' }],         outputs: [] },
  { name: 'owner',             type: 'function', stateMutability: 'view',       inputs: [],                                       outputs: [{ type: 'address' }] },
]

const account      = privateKeyToAccount(PRIVATE_KEY)
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(RPC_URL) })

console.log('\nAveris Protocol — Set Advance Rate')
console.log('=====================================')
console.log(`Chain:       Arc Testnet (${CHAIN_ID})`)
console.log(`Signer:      ${account.address}`)
console.log(`Contract:    ${FINANCING_ADDRESS}`)
console.log(`New rate:    ${newRateBps} bps (${newRateBps / 100}%)`)

// Pre-flight
const owner = await publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'owner' })
if (owner.toLowerCase() !== account.address.toLowerCase()) {
  console.error(`\n  ✗ Signer is NOT the contract owner (owner is ${owner})\n`)
  process.exit(1)
}

const currentRate = await publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'advanceRateBps' })
console.log(`\nCurrent rate: ${currentRate} bps (${Number(currentRate) / 100}%)`)

if (Number(currentRate) === newRateBps) {
  console.log(`\n  ✓ Already set to ${newRateBps} bps. Nothing to do.\n`)
  process.exit(0)
}

console.log(`\nSending setAdvanceRateBps(${newRateBps})...`)

const hash = await walletClient.writeContract({
  address:      FINANCING_ADDRESS,
  abi:          ABI,
  functionName: 'setAdvanceRateBps',
  args:         [newRateBps],
})

console.log(`  tx: ${hash}`)
console.log('  Waiting for confirmation...')

const receipt = await publicClient.waitForTransactionReceipt({ hash })

if (receipt.status === 'success') {
  const updated = await publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'advanceRateBps' })
  console.log(`\n  ✓ Advance rate updated: ${Number(updated) / 100}%`)
  console.log(`  Explorer: https://explorer.testnet.arc.io/tx/${hash}\n`)
} else {
  console.error(`\n  ✗ Transaction reverted: ${hash}\n`)
  process.exit(1)
}
