#!/usr/bin/env node
/**
 * Averis Protocol — Set Advance Rate
 * Calls AverisFinancingV2.setParameters(ar, f, m, perTx) keeping existing
 * fee/max/perTx values and only changing the advance rate.
 * Usage: node scripts/set-advance-rate.mjs [bps]
 * Example: node scripts/set-advance-rate.mjs 4000   ← sets to 40%
 */

import { createWalletClient, createPublicClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const env = readFileSync(resolve(__dirname, '../.env'), 'utf8')
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && v.length) process.env[k.trim()] = v.join('=').trim()
  }
} catch {}

const PRIVATE_KEY       = process.env.PRIVATE_KEY
const RPC_URL           = process.env.ARC_RPC_URL    || 'https://rpc.testnet.arc.io'
const CHAIN_ID          = Number(process.env.ARC_CHAIN_ID || 1227)
const FINANCING_ADDRESS = (process.env.AVERIS_FINANCING || '0x20429b8d5eef0bfbfb1d14eb8b2a1ce94817b36f')

if (!PRIVATE_KEY) { console.error('\nMissing PRIVATE_KEY in .env\n'); process.exit(1) }

const newRateBps = Number(process.argv[2] ?? 4000)
if (isNaN(newRateBps) || newRateBps < 100 || newRateBps > 9000) {
  console.error('\nInvalid rate. Must be 100–9000 bps (e.g. 4000 = 40%).\n')
  process.exit(1)
}

const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

const ABI = [
  { name: 'owner',            type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'advanceRateBps',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16'  }] },
  { name: 'feeBps',           type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16'  }] },
  { name: 'protocolMaximum',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  { name: 'defaultPerTxLimit',type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  {
    name: 'setParameters', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'ar',    type: 'uint16'  },
      { name: 'f',     type: 'uint16'  },
      { name: 'm',     type: 'uint128' },
      { name: 'perTx', type: 'uint128' },
    ],
    outputs: [],
  },
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

// Pre-flight: confirm owner
const owner = await publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'owner' })
if (owner.toLowerCase() !== account.address.toLowerCase()) {
  console.error(`\n  ✗ Signer is NOT the contract owner (owner is ${owner})\n`)
  process.exit(1)
}

// Read current values — keep fee/max/perTx unchanged
const [currentRate, feeBps, protocolMax, perTxLimit] = await Promise.all([
  publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'advanceRateBps' }),
  publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'feeBps' }),
  publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'protocolMaximum' }),
  publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'defaultPerTxLimit' }),
])

console.log(`\nCurrent parameters:`)
console.log(`  advanceRateBps:  ${Number(currentRate)} (${Number(currentRate)/100}%)`)
console.log(`  feeBps:          ${Number(feeBps)} (${Number(feeBps)/100}%)`)
console.log(`  protocolMaximum: ${protocolMax}`)
console.log(`  defaultPerTxLimit: ${perTxLimit}`)

if (Number(currentRate) === newRateBps) {
  console.log(`\n  ✓ Already set to ${newRateBps} bps. Nothing to do.\n`)
  process.exit(0)
}

console.log(`\nCalling setParameters(${newRateBps}, ${feeBps}, ${protocolMax}, ${perTxLimit})...`)

const hash = await walletClient.writeContract({
  address:      FINANCING_ADDRESS,
  abi:          ABI,
  functionName: 'setParameters',
  args:         [newRateBps, Number(feeBps), BigInt(protocolMax), BigInt(perTxLimit)],
})

console.log(`  tx: ${hash}`)
console.log('  Waiting for confirmation...')

const receipt = await publicClient.waitForTransactionReceipt({ hash })

if (receipt.status === 'success') {
  const updated = await publicClient.readContract({ address: FINANCING_ADDRESS, abi: ABI, functionName: 'advanceRateBps' })
  console.log(`\n  ✓ Advance rate updated: ${Number(updated) / 100}%`)
  console.log(`  Fee and limits unchanged.`)
  console.log(`  Explorer: https://explorer.testnet.arc.io/tx/${hash}\n`)
} else {
  console.error(`\n  ✗ Transaction reverted: ${hash}\n`)
  process.exit(1)
}
