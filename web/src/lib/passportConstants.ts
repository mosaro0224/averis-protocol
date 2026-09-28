/**
 * Passport constants — chain config, contract addresses, ERC-8004 registries.
 * Import these; never type chain-specific values elsewhere.
 */

export const RH_TESTNET = {
  id: 46630,
  name: 'Robinhood Chain Testnet',
  rpc: 'https://rpc.testnet.chain.robinhood.com',
  explorer: 'https://explorer.testnet.chain.robinhood.com',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  isTestnet: true,
}

export const ARC_TESTNET = {
  id: 5042002,
  name: 'Arc Testnet',
  rpc: 'https://rpc.testnet.arc.io',
  explorer: 'https://explorer.testnet.arc.io',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  isTestnet: true,
}

/** ERC-8004 registry addresses — CREATE2-deterministic, same on all testnets */
export const ERC8004_TESTNET = {
  identityRegistry:   '0x8004A818BFB912233c491871b3d84c89A494BD9e' as `0x${string}`,
  reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713' as `0x${string}`,
  validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272' as `0x${string}`,
}

/** ERC-8004 registry addresses — same on all mainnets */
export const ERC8004_MAINNET = {
  identityRegistry:   '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`,
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as `0x${string}`,
  validationRegistry: null,
}

/** Passport contracts — deployed on Robinhood Chain Testnet (46630) */
export const PASSPORT_CONTRACTS = {
  policyRegistry:  (import.meta.env.VITE_PASSPORT_POLICY_REGISTRY  || '0xf7F47493E2f042a428a531724bE62854002979cA') as `0x${string}`,
  receiptRegistry: (import.meta.env.VITE_PASSPORT_RECEIPT_REGISTRY || '0x3477e203fCFFbfe0E419E230d115d7C80A22BB18') as `0x${string}`,
}

/** Averis Passport API base */
export const PASSPORT_API = import.meta.env.VITE_API_URL ?? 'https://api.averisprotocol.xyz'

export const CAPABILITY_TYPES = [
  { type: 'research',      label: 'Research' },
  { type: 'coding',        label: 'Coding' },
  { type: 'api_execution', label: 'API Execution' },
  { type: 'trading',       label: 'Trading' },
  { type: 'payments',      label: 'Payments' },
  { type: 'defi',          label: 'DeFi' },
  { type: 'data_analysis', label: 'Data Analysis' },
  { type: 'compute',       label: 'Compute' },
  { type: 'other',         label: 'Other' },
]

export type CapabilityType = typeof CAPABILITY_TYPES[number]['type']
