import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { QueryClient } from '@tanstack/react-query'
import { arcTestnet } from './constants'

// Reown Project ID — public value, safe to commit
const projectId = 'b56e18d47c72ab683b7fe84e3d4c8547'

export const queryClient = new QueryClient()

export const wagmiAdapter = new WagmiAdapter({
  networks: [arcTestnet],
  projectId,
})

export const wagmiConfig = wagmiAdapter.wagmiConfig

createAppKit({
  adapters: [wagmiAdapter],
  networks: [arcTestnet],
  projectId,
  metadata: {
    name: 'Averis Protocol',
    description: 'Working capital for AI agents',
    url: 'https://averisprotocol.xyz',
    icons: ['https://averisprotocol.xyz/favicon.svg'],
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-font-family': 'DM Sans, sans-serif',
    '--w3m-accent': '#9cf57d',
    '--w3m-color-mix': '#0f120f',
    '--w3m-border-radius-master': '2px',
  },
  features: { analytics: false },
})
