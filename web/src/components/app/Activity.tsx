import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'

const API = import.meta.env.VITE_API_URL || 'https://api.averisprotocol.xyz'
const EXPLORER = 'https://explorer.testnet.arc.io/tx/'

interface ActivityEvent {
  event:   string
  agent:   string
  jobId:   string
  amount:  string
  fee?:    string
  pool?:   string
  block:   string
  tx:      string
}

const EVENT_LABEL: Record<string, string> = {
  Drawn:     'DRAW',
  Repaid:    'REPAID',
  Defaulted: 'DEFAULT',
}

const EVENT_COLOR: Record<string, string> = {
  Drawn:     'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  Repaid:    'text-blue-400   bg-blue-400/10   border-blue-400/20',
  Defaulted: 'text-red-400    bg-red-400/10    border-red-400/20',
}

function fmt(usdc6: string) {
  return (Number(BigInt(usdc6 || '0')) / 1e6).toFixed(2)
}

function shortAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—'
}

export function Activity() {
  const { address: connectedWallet } = useAccount()
  const [events, setEvents]     = useState<ActivityEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [myOnly, setMyOnly]     = useState(false)
  const [lastBlock, setLastBlock] = useState<string | null>(null)

  function load(agentFilter?: string) {
    setLoading(true); setError(false)
    const url = agentFilter
      ? `${API}/v1/activity?agent=${agentFilter}&limit=100`
      : `${API}/v1/activity?limit=100`
    fetch(url)
      .then(r => r.json())
      .then(d => {
        setEvents(d.events ?? [])
        setUpdatedAt(d.updated_at ?? null)
        setLastBlock(d.last_indexed_block ?? null)
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }

  useEffect(() => { load(myOnly && connectedWallet ? connectedWallet : undefined) }, [myOnly, connectedWallet])

  // Poll every 30s
  useEffect(() => {
    const iv = setInterval(() => load(myOnly && connectedWallet ? connectedWallet : undefined), 30_000)
    return () => clearInterval(iv)
  }, [myOnly, connectedWallet])

  return (
    <div className="w-full px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-2">PROTOCOL ACTIVITY</div>
          <h2 className="font-display text-[24px] font-bold text-averis-text">Activity</h2>
          <p className="text-[13px] text-averis-muted2 mt-1">Live draws, repayments and defaults from AverisFinancingV2.</p>
        </div>
        <div className="flex items-center gap-3 mt-1">
          {connectedWallet && (
            <button
              onClick={() => setMyOnly(v => !v)}
              className={`font-mono text-[10px] px-3 py-1.5 rounded border transition-colors ${
                myOnly
                  ? 'bg-averis-green text-black border-averis-green'
                  : 'text-averis-muted border-averis-line hover:border-averis-muted'
              }`}
            >
              {myOnly ? 'MY ACTIVITY' : 'ALL ACTIVITY'}
            </button>
          )}
          <button
            onClick={() => load(myOnly && connectedWallet ? connectedWallet : undefined)}
            className="font-mono text-[10px] px-3 py-1.5 rounded border border-averis-line text-averis-muted hover:border-averis-muted transition-colors"
          >
            REFRESH
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && !error && (
        <div className="flex gap-6 flex-wrap">
          <div>
            <div className="font-mono text-[9px] text-averis-muted mb-0.5">EVENTS INDEXED</div>
            <div className="font-mono text-[13px] text-averis-text">{events.length}</div>
          </div>
          {lastBlock && (
            <div>
              <div className="font-mono text-[9px] text-averis-muted mb-0.5">LAST BLOCK</div>
              <div className="font-mono text-[13px] text-averis-text">{Number(lastBlock).toLocaleString()}</div>
            </div>
          )}
          {updatedAt && (
            <div>
              <div className="font-mono text-[9px] text-averis-muted mb-0.5">INDEXED AT</div>
              <div className="font-mono text-[13px] text-averis-text">{new Date(updatedAt).toLocaleTimeString()}</div>
            </div>
          )}
          <div>
            <div className="font-mono text-[9px] text-averis-muted mb-0.5">DRAWS</div>
            <div className="font-mono text-[13px] text-emerald-400">{events.filter(e => e.event === 'Drawn').length}</div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-averis-muted mb-0.5">REPAID</div>
            <div className="font-mono text-[13px] text-blue-400">{events.filter(e => e.event === 'Repaid').length}</div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-averis-muted mb-0.5">DEFAULTS</div>
            <div className="font-mono text-[13px] text-red-400">{events.filter(e => e.event === 'Defaulted').length}</div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading && (
        <div className="border border-averis-line rounded p-8 text-center">
          <p className="font-mono text-[11px] text-averis-muted animate-pulse">LOADING EVENTS…</p>
        </div>
      )}

      {error && (
        <div className="border border-red-800 rounded p-6 text-center">
          <p className="font-mono text-[11px] text-red-400">Failed to load activity. API may be restarting.</p>
          <button onClick={() => load()} className="font-mono text-[10px] text-averis-muted mt-2 underline">Retry</button>
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="border border-averis-line rounded p-8 text-center">
          <p className="font-mono text-[11px] text-averis-muted">No events indexed yet.</p>
          <p className="font-mono text-[10px] text-averis-muted/60 mt-1">Events are indexed every 5 minutes from AverisFinancingV2.</p>
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="space-y-2">
          {events.map((e, i) => (
            <div
              key={`${e.tx}-${i}`}
              className="bg-averis-card border border-averis-line rounded px-4 py-3 flex items-center gap-4 hover:border-averis-muted/40 transition-colors"
            >
              {/* Event badge */}
              <span className={`font-mono text-[9px] px-2 py-0.5 rounded border shrink-0 ${EVENT_COLOR[e.event] ?? 'text-averis-muted bg-averis-bg border-averis-line'}`}>
                {EVENT_LABEL[e.event] ?? e.event}
              </span>

              {/* Agent */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-averis-text">{shortAddr(e.agent)}</span>
                  {connectedWallet && e.agent?.toLowerCase() === connectedWallet.toLowerCase() && (
                    <span className="font-mono text-[8px] text-averis-green bg-averis-green/10 px-1.5 py-0.5 rounded">YOU</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-[9px] text-averis-muted">Job #{e.jobId}</span>
                  {e.block && <span className="font-mono text-[9px] text-averis-muted/50">Block {Number(e.block).toLocaleString()}</span>}
                </div>
              </div>

              {/* Amount */}
              <div className="text-right shrink-0">
                <div className="font-mono text-[12px] text-averis-text">{fmt(e.amount)} USDC</div>
                {e.fee && e.fee !== '0' && (
                  <div className="font-mono text-[9px] text-averis-muted">Fee: {fmt(e.fee)} USDC</div>
                )}
              </div>

              {/* Tx link */}
              {e.tx && (
                <a
                  href={`${EXPLORER}${e.tx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[9px] text-averis-muted hover:text-averis-text shrink-0 transition-colors"
                  title={e.tx}
                >
                  {e.tx.slice(0, 8)}…↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
