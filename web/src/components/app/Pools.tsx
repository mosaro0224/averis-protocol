import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'

const API = import.meta.env.VITE_API_URL ?? 'https://api.averisprotocol.xyz'
const ARC_EXPLORER = 'https://explorer.arc.io/tx/'

interface Pool {
  poolAddress: string
  agent: string
  jobId: string
  approvedAmount: string
  totalSpent: string
  remaining: string
  perTxLimit: string
  expiry: string
  expiryDate: string
  timeRemainingSeconds: number
  frozen: boolean
  allowedRecipients: string[]
  spentPct: number
}

interface Position {
  jobId: string
  poolAddress: string
  principal: string
  fee: string
  status: string
  mode: string
  outstanding: string
  expiryDate: string
}

function fmt(raw: string) {
  const n = Number(raw) / 1e6
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function truncate(addr: string) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''
}

function StatusBadge({ status, frozen }: { status: string; frozen: boolean }) {
  if (frozen) return <span className="font-mono text-[9px] text-red-400 border border-red-400/40 rounded px-2 py-0.5">FROZEN</span>
  if (status === 'ACTIVE') return <span className="font-mono text-[9px] text-emerald-400 border border-emerald-400/40 rounded px-2 py-0.5">ACTIVE</span>
  if (status === 'REPAID') return <span className="font-mono text-[9px] text-blue-400 border border-blue-400/40 rounded px-2 py-0.5">REPAID</span>
  return <span className="font-mono text-[9px] text-averis-muted border border-averis-line rounded px-2 py-0.5">{status}</span>
}

export function Pools() {
  const { address } = useAccount()
  const [positions, setPositions] = useState<Position[]>([])
  const [pools, setPools] = useState<Record<string, Pool>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lookupAddress, setLookupAddress] = useState('')
  const [viewAddress, setViewAddress] = useState('')

  async function loadPools(agent: string) {
    setLoading(true)
    setError(null)
    try {
      // Get job IDs from activity events (Drawn events by this agent)
      const r = await fetch(`${API}/v1/activity`)
      if (!r.ok) throw new Error(`API error ${r.status}`)
      const d = await r.json()
      const jobIds: string[] = (d.events ?? [])
        .filter((e: any) => e.event === 'Drawn' && e.agent?.toLowerCase() === agent.toLowerCase())
        .map((e: any) => e.jobId)
        .filter((id: string, i: number, arr: string[]) => arr.indexOf(id) === i) // dedupe

      // Load each position
      const posResults: Position[] = []
      const poolMap: Record<string, Pool> = {}
      await Promise.all(jobIds.map(async (jobId: string) => {
        try {
          const pr = await fetch(`${API}/v2/positions/${jobId}`)
          if (!pr.ok) return
          const pos = await pr.json()
          posResults.push(pos)
          if (pos.poolAddress && pos.poolAddress !== '0x0000000000000000000000000000000000000001') {
            const poolr = await fetch(`${API}/v2/pools/${pos.poolAddress}`)
            if (poolr.ok) poolMap[pos.poolAddress] = await poolr.json()
          }
        } catch {}
      }))
      setPositions(posResults)
      setPools(poolMap)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Auto-load when wallet connects
  useEffect(() => {
    if (address && !viewAddress) {
      setViewAddress(address)
      loadPools(address)
    }
  }, [address])

  function handleLookup() {
    const addr = lookupAddress.trim()
    if (!addr.match(/^0x[0-9a-fA-F]{40}$/)) return
    setViewAddress(addr)
    loadPools(addr)
  }

  const activePools = Object.values(pools).filter(p => !p.frozen)
  const frozenPools = Object.values(pools).filter(p => p.frozen)

  return (
    <div className="w-full px-8 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-3">JOB SPENDING POOLS</div>
        <h2 className="font-display text-[28px] font-bold text-averis-text mb-2">Pools</h2>
        <p className="text-[14px] text-averis-muted2 max-w-[520px]">
          Each draw creates an isolated spending pool. Capital flows only to whitelisted recipients for the duration of the job.
        </p>
      </div>

      {/* Properties */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-averis-line border border-averis-line">
        {[
          ['ISOLATED', 'Each pool is deployed per job. No cross-contamination between positions.'],
          ['PERMISSIONED', 'Only approved recipients can receive capital from a pool.'],
          ['TIME-BOUNDED', 'Pool freezes at job expiry. Remaining funds return to vault.'],
        ].map(([label, desc]) => (
          <div key={label} className="bg-averis-panel p-5">
            <div className="font-mono text-[9px] tracking-[0.14em] text-averis-green mb-2">{label}</div>
            <div className="text-[13px] text-averis-muted2">{desc}</div>
          </div>
        ))}
      </div>

      {/* Lookup bar */}
      <div className="flex gap-2">
        <input
          value={lookupAddress}
          onChange={e => setLookupAddress(e.target.value)}
          placeholder={address ?? 'Agent wallet address (0x...)'}
          className="flex-1 bg-[#1a1a1a] border border-[#444] text-white placeholder:text-[#555] font-mono text-[11px] px-3 py-2 rounded focus:outline-none focus:border-averis-green"
          onKeyDown={e => e.key === 'Enter' && handleLookup()}
        />
        <button
          onClick={handleLookup}
          className="font-mono text-[10px] tracking-widest bg-averis-green text-black px-4 py-2 rounded hover:bg-emerald-400 transition-colors"
        >
          LOOKUP
        </button>
        {address && viewAddress !== address && (
          <button
            onClick={() => { setViewAddress(address); setLookupAddress(''); loadPools(address) }}
            className="font-mono text-[10px] tracking-widest border border-averis-line text-averis-muted px-4 py-2 rounded hover:text-averis-text transition-colors"
          >
            MY POOLS
          </button>
        )}
      </div>

      {viewAddress && (
        <p className="font-mono text-[10px] text-averis-muted">
          Viewing: <span className="text-averis-text2">{viewAddress}</span>
          {address && viewAddress.toLowerCase() === address.toLowerCase() && (
            <span className="ml-2 text-averis-green">(you)</span>
          )}
        </p>
      )}

      {loading && <p className="font-mono text-[11px] text-averis-muted">Loading pools...</p>}
      {error && <p className="font-mono text-[11px] text-red-400">Error: {error}</p>}

      {/* Active pools */}
      {!loading && viewAddress && (
        <>
          {activePools.length === 0 && frozenPools.length === 0 && positions.length === 0 ? (
            <div className="border border-dashed border-averis-line p-16 text-center">
              <div className="font-mono text-[10px] text-averis-muted mb-2">NO ACTIVE POOLS</div>
              <div className="text-[12px] text-averis-muted2">Active job pools will appear here once financing is drawn.</div>
            </div>
          ) : (
            <div className="space-y-4">
              {positions.map(pos => {
                const pool = pools[pos.poolAddress]
                return (
                  <div key={pos.jobId} className="border border-averis-line rounded bg-averis-card">
                    {/* Pool header */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-averis-line">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[10px] text-averis-muted">JOB</span>
                        <span className="font-mono text-[13px] text-averis-text font-bold">#{pos.jobId}</span>
                        <StatusBadge status={pos.status} frozen={pool?.frozen ?? false} />
                        <span className="font-mono text-[9px] text-averis-muted border border-averis-line/50 rounded px-2 py-0.5">{pos.mode}</span>
                      </div>
                      <span className="font-mono text-[10px] text-averis-muted">
                        Expires {new Date(pos.expiryDate).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-averis-line">
                      <Stat label="PRINCIPAL" value={`${fmt(pos.principal)} USDC`} />
                      <Stat label="FEE" value={`${fmt(pos.fee)} USDC`} />
                      <Stat label="OUTSTANDING" value={`${fmt(pos.outstanding)} USDC`} highlight />
                      <Stat label="STATUS" value={pos.status} />
                    </div>

                    {pool && (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-averis-line border-t border-averis-line">
                          <Stat label="POOL APPROVED" value={`${fmt(pool.approvedAmount)} USDC`} />
                          <Stat label="SPENT" value={`${fmt(pool.totalSpent)} USDC`} />
                          <Stat label="REMAINING" value={`${fmt(pool.remaining)} USDC`} highlight />
                          <Stat label="SPENT %" value={`${pool.spentPct.toFixed(1)}%`} />
                        </div>

                        {/* Progress bar */}
                        <div className="px-5 py-3 border-t border-averis-line">
                          <div className="flex justify-between mb-1">
                            <span className="font-mono text-[9px] text-averis-muted">POOL UTILISATION</span>
                            <span className="font-mono text-[9px] text-averis-text">{pool.spentPct.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-averis-line rounded-full h-1">
                            <div
                              className="bg-averis-green h-1 rounded-full transition-all"
                              style={{ width: `${Math.min(pool.spentPct, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Pool details */}
                        <div className="px-5 py-3 border-t border-averis-line space-y-2">
                          <div className="flex justify-between">
                            <span className="font-mono text-[9px] text-averis-muted">POOL ADDRESS</span>
                            <span className="font-mono text-[9px] text-averis-text2">{truncate(pool.poolAddress)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-mono text-[9px] text-averis-muted">PER-TX LIMIT</span>
                            <span className="font-mono text-[9px] text-averis-text2">{fmt(pool.perTxLimit)} USDC</span>
                          </div>
                          {pool.allowedRecipients.length > 0 && (
                            <div>
                              <span className="font-mono text-[9px] text-averis-muted block mb-1">ALLOWED RECIPIENTS</span>
                              {pool.allowedRecipients.map(r => (
                                <span key={r} className="font-mono text-[9px] text-averis-text2 block">{r}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {!viewAddress && !loading && (
        <div className="border border-dashed border-averis-line p-16 text-center">
          <div className="font-mono text-[10px] text-averis-muted mb-2">
            {address ? 'LOADING YOUR POOLS...' : 'CONNECT WALLET OR ENTER ADDRESS'}
          </div>
          <div className="text-[12px] text-averis-muted2">
            {address ? '' : 'Enter an agent wallet address above to view their active spending pools.'}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-averis-panel p-4">
      <div className="font-mono text-[9px] text-averis-muted mb-1">{label}</div>
      <div className={`font-mono text-[13px] font-bold ${highlight ? 'text-averis-green' : 'text-averis-text'}`}>{value}</div>
    </div>
  )
}
