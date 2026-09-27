import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { API_BASE } from '../../lib/constants'

interface Policy {
  policyId: string
  policyHash: string
  contentURI: string | null
  expiresAt: number
  agentId: string
  chainId: number | null
  onChainTxHash: string | null
  revoked: boolean
  verState: string
  savedAt: number
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function PassportPolicies() {
  const { address } = useAccount()
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!address) return
    setLoading(true)
    fetch(`${API_BASE}/v2/passport/${address}/policies`)
      .then(r => r.json())
      .then(d => { setPolicies(d.policies ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [address])

  if (!address) return (
    <div className="w-full px-8 py-12 text-center font-mono text-[10px] text-averis-muted">CONNECT WALLET</div>
  )

  return (
    <div className="w-full px-8 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-[0.1em] text-averis-muted">POLICIES</div>
        <div className="font-mono text-[9px] text-averis-muted">{policies.length} total</div>
      </div>

      {loading && <div className="font-mono text-[10px] text-averis-muted">Loading…</div>}

      {!loading && policies.length === 0 && (
        <div className="border border-dashed border-averis-line p-6 text-center space-y-2">
          <div className="font-mono text-[10px] tracking-[0.08em] text-averis-muted">NO POLICIES</div>
          <p className="text-xs text-averis-muted">
            No policies committed yet. Call <code className="text-averis-text2">AgentPolicyRegistry.commitPolicy()</code> on-chain
            to anchor a policy hash, then record it here via the API or MCP tool.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {policies.map(p => (
          <div key={p.policyId} className={`border p-4 space-y-2 ${p.revoked ? 'border-averis-line opacity-50' : 'border-averis-line'}`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-averis-text">Policy #{p.policyId}</span>
              <div className="flex gap-2">
                <span className={`font-mono text-[8px] tracking-[0.08em] px-1.5 py-0.5 border ${
                  p.revoked
                    ? 'border-red-900/40 text-red-400 bg-red-950/20'
                    : p.expiresAt && p.expiresAt * 1000 < Date.now()
                    ? 'border-yellow-900/40 text-yellow-500'
                    : 'border-averis-green/30 text-averis-green bg-averis-green/5'
                }`}>
                  {p.revoked ? 'REVOKED' : p.expiresAt && p.expiresAt * 1000 < Date.now() ? 'EXPIRED' : 'ACTIVE'}
                </span>
                <span className="font-mono text-[8px] tracking-[0.08em] px-1.5 py-0.5 border border-averis-line text-averis-muted">
                  {p.verState ?? 'SELF_REPORTED'}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-averis-muted">hash</span>
                <span className="font-mono text-[9px] text-averis-text2">{p.policyHash?.slice(0, 18)}…</span>
              </div>
              {p.chainId && (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-averis-muted">chain</span>
                  <span className="font-mono text-[9px] text-averis-text2">{p.chainId}</span>
                </div>
              )}
              {p.expiresAt > 0 && (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-averis-muted">expires</span>
                  <span className="font-mono text-[9px] text-averis-text2">{formatDate(p.expiresAt * 1000)}</span>
                </div>
              )}
              {p.savedAt && (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-averis-muted">recorded</span>
                  <span className="font-mono text-[9px] text-averis-text2">{formatDate(p.savedAt)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
