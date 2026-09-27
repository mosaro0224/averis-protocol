import { useState, useEffect } from 'react'
import { API_BASE } from '../../lib/constants'

interface ChainInfo {
  chainId: number
  chainName: string
  isTestnet: boolean
  explorer: string
  erc8004: {
    identityRegistry: string
    reputationRegistry: string
    validationRegistry: string
  }
}

export function PassportChains() {
  const [chains, setChains] = useState<ChainInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/v2/passport/chains`)
      .then(r => r.json())
      .then(d => { setChains(d.chains ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="w-full px-8 py-8 space-y-6">
      <div className="font-mono text-[10px] tracking-[0.1em] text-averis-muted">SUPPORTED CHAINS</div>

      {loading && <div className="font-mono text-[10px] text-averis-muted">Loading…</div>}

      <div className="space-y-3">
        {chains.map(c => (
          <div key={c.chainId} className="border border-averis-line p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-averis-text">{c.chainName}</span>
              <div className="flex gap-2">
                <span className="font-mono text-[8px] tracking-[0.08em] px-1.5 py-0.5 border border-averis-line text-averis-muted">
                  CHAIN {c.chainId}
                </span>
                {c.isTestnet && (
                  <span className="font-mono text-[8px] tracking-[0.08em] px-1.5 py-0.5 border border-yellow-900/40 text-yellow-500">
                    TESTNET
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-averis-muted">IdentityRegistry</span>
                <a
                  href={`${c.explorer}/address/${c.erc8004.identityRegistry}`}
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[9px] text-averis-muted hover:text-averis-text transition-colors no-underline"
                >
                  {c.erc8004.identityRegistry.slice(0, 10)}…{c.erc8004.identityRegistry.slice(-6)}
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-averis-muted">ReputationRegistry</span>
                <a
                  href={`${c.explorer}/address/${c.erc8004.reputationRegistry}`}
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[9px] text-averis-muted hover:text-averis-text transition-colors no-underline"
                >
                  {c.erc8004.reputationRegistry.slice(0, 10)}…{c.erc8004.reputationRegistry.slice(-6)}
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ERC-8004 note */}
      <div className="border border-averis-line p-4 space-y-1">
        <div className="font-mono text-[9px] tracking-[0.08em] text-averis-muted mb-2">ERC-8004 CANONICAL ADDRESSES</div>
        <p className="text-xs text-averis-muted text-pretty">
          Registry addresses are CREATE2-deterministic — the same on all supported testnets.
          Averis does not deploy a competing registry; the canonical ERC-8004 addresses are used directly.
        </p>
      </div>
    </div>
  )
}
