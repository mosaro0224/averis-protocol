import { defineChain } from 'viem'

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
})

export const CONTRACTS = {
  vault:           '0xf7F47493E2f042a428a531724bE62854002979cA' as `0x${string}`,
  financing:       '0x102eC41EDdeed916012D7B345c42e7Be64AD2051' as `0x${string}`,
  acp:             '0x3477e203fCFFbfe0E419E230d115d7C80A22BB18' as `0x${string}`,
  router:          '0x0b2C571D2FD5199b758d426340CF8260515eFF15' as `0x${string}`,
  hood:            '0xd7D8633804FfdB3504Ba6F8036b26536f3d89E0a' as `0x${string}`,
  factory:         '0x69e875801822ffcA3C34022a2E2363d26688259a' as `0x${string}`,
  registry:        '0x0D6DBfaeAf74b45642064E6bA27F02c69872f4B0' as `0x${string}`,
  credit:          '0x9330790C74E71f16ef568c4CD6ca06662A611dd9' as `0x${string}`,
  reserve:         '0x9069f069467578c1F4B6f2385c6B52Ca86f8DDf5' as `0x${string}`,
  acpAdapter:      '0x8753aE3c8fACf0C352c4b786AF44D8eBF383D62A' as `0x${string}`,
  externalAdapter: '0xbd07EBa80Bf4b6F6999A6951Af05beC11BC833bb' as `0x${string}`,
  usdc:            '0x3600000000000000000000000000000000000000' as `0x${string}`,
} as const

export const API_BASE = 'https://api.averisprotocol.xyz'
export const EXPLORER = 'https://explorer.testnet.arc.io'
export const CHAIN_ID = 5042002
export const USDC_DECIMALS = 6
