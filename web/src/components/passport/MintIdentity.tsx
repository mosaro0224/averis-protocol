/**
 * MintIdentity — register an ERC-8004 identity on Arc Testnet, Robinhood Chain Testnet, or both.
 * Calls register(string agentURI) on the IdentityRegistry contract.
 * agentId is AUTO-ASSIGNED by the contract — no need for the user to pick one.
 */

import { useState } from 'react'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { createPublicClient, http, parseAbi } from 'viem'
import { ERC8004_TESTNET, ARC_TESTNET, RH_TESTNET, PASSPORT_API } from '../../lib/passportConstants'

const IDENTITY_ABI = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
])

type ChainTarget = 'arc' | 'rh' | 'both'
type RegStatus = 'idle' | 'switching' | 'registering' | 'linking' | 'done' | 'error'

interface ChainResult {
  chain: string
  chainId: number
  status: 'pending' | 'registering' | 'done' | 'error'
  txHash?: string
  agentId?: string
  error?: string
}

interface Props {
  address: string
  onSuccess: () => void
}

export function MintIdentity({ address, onSuccess }: Props) {
  const { chainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()

  const [metadataURI, setMetadataURI] = useState('')
  const [target, setTarget]           = useState<ChainTarget>('arc')
  const [status, setStatus]           = useState<RegStatus>('idle')
  const [results, setResults]         = useState<ChainResult[]>([])
  const [errorMsg, setErrorMsg]       = useState('')

  const chains: { key: ChainTarget; label: string; chainId: number; color: string }[] = [
    { key: 'arc',  label: 'Arc Testnet',             chainId: ARC_TESTNET.id, color: 'text-averis-green' },
    { key: 'rh',   label: 'Robinhood Chain Testnet', chainId: RH_TESTNET.id,  color: 'text-blue-400'    },
    { key: 'both', label: 'Both chains',             chainId: ARC_TESTNET.id, color: 'text-purple-400'  },
  ]

  async function registerOnChain(targetChainId: number, chainLabel: string): Promise<ChainResult> {
    if (!walletClient) return { chain: chainLabel, chainId: targetChainId, status: 'error', error: 'No wallet client' }

    setResults(r => r.map(x => x.chain === chainLabel ? { ...x, status: 'registering' } : x))

    try {
      // Switch chain if needed
      if (chainId !== targetChainId) {
        setStatus('switching')
        await switchChainAsync({ chainId: targetChainId })
      }

      setStatus('registering')

      const rpcUrl = targetChainId === ARC_TESTNET.id ? ARC_TESTNET.rpc : RH_TESTNET.rpc
      const chainDef = {
        id: targetChainId,
        name: chainLabel,
        nativeCurrency: targetChainId === ARC_TESTNET.id
          ? ARC_TESTNET.nativeCurrency
          : RH_TESTNET.nativeCurrency,
        rpcUrls: { default: { http: [rpcUrl] } },
      } as any

      const hash = await walletClient.writeContract({
        address: ERC8004_TESTNET.identityRegistry,
        abi: IDENTITY_ABI,
        functionName: 'register',
        args: [metadataURI],
        chain: chainDef,
      })

      // Wait for receipt and parse assigned agentId from Registered event
      const publicClient = createPublicClient({ chain: chainDef, transport: http(rpcUrl) })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      // Registered(uint256 indexed agentId, string agentURI, address indexed owner)
      // topics[1] = agentId (indexed)
      let assignedAgentId: string | undefined
      for (const log of receipt.logs) {
        if (log.topics[1]) {
          assignedAgentId = BigInt(log.topics[1]).toString()
          break
        }
      }

      return { chain: chainLabel, chainId: targetChainId, status: 'done', txHash: hash, agentId: assignedAgentId }
    } catch (err: any) {
      return { chain: chainLabel, chainId: targetChainId, status: 'error', error: err.shortMessage ?? err.message ?? 'Unknown error' }
    }
  }

  async function handleRegister() {
    if (!metadataURI) { setErrorMsg('Metadata URI is required'); return }
    if (!walletClient) { setErrorMsg('Connect your wallet first'); return }

    setErrorMsg('')
    setStatus('registering')

    const targets: { chainId: number; label: string }[] =
      target === 'arc'  ? [{ chainId: ARC_TESTNET.id, label: 'Arc Testnet' }] :
      target === 'rh'   ? [{ chainId: RH_TESTNET.id,  label: 'Robinhood Chain Testnet' }] :
      [{ chainId: ARC_TESTNET.id, label: 'Arc Testnet' }, { chainId: RH_TESTNET.id, label: 'Robinhood Chain Testnet' }]

    setResults(targets.map(t => ({ chain: t.label, chainId: t.chainId, status: 'pending' })))

    const finalResults: ChainResult[] = []

    for (const t of targets) {
      const result = await registerOnChain(t.chainId, t.label)
      finalResults.push(result)
      setResults(r => r.map(x => x.chain === t.label ? result : x))
    }

    // Link identities to Passport API store for each successful registration
    setStatus('linking')
    for (const r of finalResults) {
      if (r.status !== 'done') continue
      const caip2 = r.chainId === ARC_TESTNET.id ? 'eip155:5042002' : 'eip155:46630'
      try {
        await fetch(`${PASSPORT_API}/v2/agents/${address}/identity/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caip2,
            agentId: r.agentId ? Number(r.agentId) : undefined,
            registryAddress: ERC8004_TESTNET.identityRegistry,
            metadataURI,
            linkTxHash: r.txHash,
          }),
        })
      } catch { /* non-fatal — identity will appear on next chain read */ }
    }

    const anySuccess = finalResults.some(r => r.status === 'done')
    const anyError   = finalResults.some(r => r.status === 'error')

    if (anySuccess) {
      setStatus('done')
      setTimeout(onSuccess, 1500)
    } else if (anyError) {
      setStatus('error')
    }
  }

  const busy = status === 'switching' || status === 'registering' || status === 'linking'

  return (
    <div className="border border-averis-line rounded p-6 space-y-5 bg-averis-card">
      <div>
        <h3 className="font-mono text-[10px] tracking-[0.14em] text-averis-text mb-1">REGISTER ERC-8004 IDENTITY</h3>
        <p className="font-mono text-[9px] text-averis-muted/70">
          Register an onchain identity token for this wallet. Your Agent ID will be automatically assigned by the registry.
          After registration, your identity is readable on any supported chain.
        </p>
      </div>

      {/* Chain selector */}
      <div className="space-y-1.5">
        <p className="font-mono text-[9px] text-averis-muted uppercase">Chain</p>
        <div className="flex gap-2 flex-wrap">
          {chains.map(c => (
            <button
              key={c.key}
              onClick={() => setTarget(c.key)}
              disabled={busy}
              className={[
                'font-mono text-[9px] px-3 py-1.5 rounded border transition-colors cursor-pointer',
                target === c.key
                  ? `border-averis-green bg-averis-green/10 ${c.color}`
                  : 'border-[#444] text-[#aaa] hover:border-[#888] hover:text-white bg-[#1a1a1a]',
                busy ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metadata URI */}
      <div className="space-y-1.5">
        <label className="font-mono text-[9px] text-averis-muted uppercase">Agent URI</label>
        <input
          type="text"
          value={metadataURI}
          onChange={e => setMetadataURI(e.target.value)}
          placeholder="https://averisprotocol.xyz/.well-known/agent-card.json"
          disabled={busy}
          className="w-full font-mono text-[10px] bg-[#1a1a1a] border border-[#444] rounded px-3 py-2 text-white placeholder:text-[#666] focus:outline-none focus:border-blue-400 disabled:opacity-50"
        />
        <p className="font-mono text-[9px] text-averis-muted/60">URL or IPFS hash pointing to an agent-card.json describing this agent.</p>
      </div>

      {/* Error */}
      {errorMsg && (
        <p className="font-mono text-[10px] text-red-400">{errorMsg}</p>
      )}

      {/* Progress */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map(r => (
            <div key={r.chain} className="flex items-center gap-3">
              <span className={[
                'w-2 h-2 rounded-full shrink-0',
                r.status === 'done'        ? 'bg-emerald-400' :
                r.status === 'error'       ? 'bg-red-400'     :
                r.status === 'registering' ? 'bg-amber-400 animate-pulse' :
                'bg-averis-line',
              ].join(' ')} />
              <span className="font-mono text-[10px] text-averis-text">{r.chain}</span>
              {r.agentId && r.status === 'done' && (
                <span className="font-mono text-[9px] text-averis-muted">ID: {r.agentId}</span>
              )}
              <span className={`font-mono text-[9px] ml-auto ${r.status === 'done' ? 'text-emerald-400' : r.status === 'error' ? 'text-red-400' : 'text-averis-muted'}`}>
                {r.status === 'pending'     ? 'QUEUED'       :
                 r.status === 'registering' ? 'REGISTERING...' :
                 r.status === 'done'        ? 'REGISTERED'   :
                 r.error ?? 'FAILED'}
              </span>
            </div>
          ))}
          {status === 'linking' && (
            <p className="font-mono text-[9px] text-averis-muted animate-pulse">Linking identity to Passport...</p>
          )}
          {status === 'done' && (
            <p className="font-mono text-[9px] text-emerald-400">Identity registered. Reloading passport...</p>
          )}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleRegister}
        disabled={busy || !metadataURI}
        className="flex items-center gap-2 font-mono text-[10px] tracking-[0.06em] bg-averis-green text-averis-greendark font-bold px-5 py-2.5 hover:bg-[#b3fa99] transition-colors border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <span className="w-3 h-3 border border-averis-greendark/60 border-t-averis-greendark rounded-full animate-spin" />
            {status === 'switching' ? 'SWITCHING CHAIN...' : status === 'linking' ? 'LINKING...' : 'REGISTERING...'}
          </>
        ) : (
          <>
            REGISTER IDENTITY
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </>
        )}
      </button>
    </div>
  )
}
