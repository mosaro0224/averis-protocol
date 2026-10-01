import { useAccount } from 'wagmi'
import { useState, useEffect } from 'react'
import { API_BASE } from '../../lib/constants'

const LIFECYCLE = [
  { step: '01', label: 'REGISTER', desc: 'Present your agent wallet address to the protocol.' },
  { step: '02', label: 'VERIFY JOB', desc: 'Point Averis to a funded job escrow on ACP or an external whitelisted platform.' },
  { step: '03', label: 'SET RECIPIENTS', desc: 'Specify allowed spending addresses for the job pool.' },
  { step: '04', label: 'DRAW', desc: 'Call draw() — Averis advances up to 40% of job budget into a controlled pool.' },
  { step: '05', label: 'SPEND', desc: 'Spend from pool on job-related costs only (vendors, APIs, sub-agents).' },
  { step: '06', label: 'SETTLE', desc: 'Job completes — ReceivableRouter routes repayment to vault. Fee charged at settlement.' },
]

export function Agents() {
  const { address } = useAccount()
  const [elig, setElig] = useState<any>(null)

  useEffect(() => {
    if (!address) return
    fetch(`${API_BASE}/v1/agents/${address}/eligibility`)
      .then(r => r.json())
      .then(setElig)
      .catch(() => null)
  }, [address])

  return (
    <div className="w-full px-8 py-8 space-y-8">
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-3">AGENT IDENTITY</div>
        <h2 className="font-display text-[28px] font-bold text-averis-text mb-2">Agents</h2>
        <p className="text-[14px] text-averis-muted2 max-w-[520px]">
          Averis extends working capital to AI agents backed by verifiable, funded job escrows. Non-recourse.
        </p>
      </div>

      {/* Agent card */}
      {address ? (
        <div className="border border-averis-line p-5 space-y-3">
          <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-2">AGENT WALLET</div>
          <div className="font-mono text-[12px] text-averis-text break-all">{address}</div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-averis-bg p-3">
              <div className="font-mono text-[9px] text-averis-muted mb-1">CREDIT LIMIT</div>
              <div className="font-display text-[18px] font-semibold text-averis-text">
                {elig ? `$${Number(elig.creditLimit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
              </div>
            </div>
            <div className="bg-averis-bg p-3">
              <div className="font-mono text-[9px] text-averis-muted mb-1">ELIGIBLE</div>
              <div className="font-display text-[18px] font-semibold text-averis-text">
                {elig ? (elig.eligible ? <span className="text-emerald-400">YES</span> : <span className="text-red-400">NO</span>) : '—'}
              </div>
            </div>
            <div className="bg-averis-bg p-3">
              <div className="font-mono text-[9px] text-averis-muted mb-1">ACTIVE POSITIONS</div>
              <div className="font-display text-[18px] font-semibold text-averis-text">
                {elig ? `${elig.activePositions ?? 0} / ${elig.maxPositions ?? 5}` : '—'}
              </div>
            </div>
            <div className="bg-averis-bg p-3">
              <div className="font-mono text-[9px] text-averis-muted mb-1">AVAILABLE CREDIT</div>
              <div className="font-display text-[18px] font-semibold text-averis-text">
                {elig ? `$${Number(elig.availableCredit ?? elig.creditLimit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
              </div>
            </div>
          </div>
          <a
            href={`${API_BASE}/v1/agents/${address}/eligibility`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-[9px] text-averis-muted hover:text-averis-text no-underline transition-colors mt-2"
          >
            View full eligibility →
          </a>
        </div>
      ) : (
        <div className="border border-dashed border-averis-line p-12 text-center">
          <p className="font-mono text-[10px] text-averis-muted">Connect wallet to view agent profile</p>
        </div>
      )}

      {/* Lifecycle */}
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">FINANCING LIFECYCLE</div>
        <div className="space-y-0">
          {LIFECYCLE.map((item, i) => (
            <div key={item.step} className={`flex items-start gap-4 px-5 py-4 border border-averis-line ${i > 0 ? '-mt-px' : ''}`}>
              <span className="font-mono text-[9px] text-averis-muted2 w-6 shrink-0 mt-0.5">{item.step}</span>
              <div>
                <div className="font-mono text-[10px] tracking-[0.1em] text-averis-text mb-0.5">{item.label}</div>
                <div className="font-mono text-[10px] text-averis-muted">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API */}
      <div className="border border-averis-line bg-averis-panel p-5">
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-3">AGENT API</div>
        <div className="space-y-2">
          {[
            ['GET', '/v1/discover', 'Protocol parameters and contract addresses'],
            ['GET', '/v1/agents/{address}/eligibility', 'Credit limit and active positions'],
            ['POST', '/v2/credit/quote', 'Quote with terms_hash for draw verification'],
            ['GET', '/v1/activity', 'Recent protocol activity'],
          ].map(([method, path, desc]) => (
            <div key={path} className="flex items-start gap-3">
              <span className={`font-mono text-[9px] px-1.5 py-0.5 shrink-0 mt-0.5 ${method === 'GET' ? 'bg-averis-green/10 text-averis-green' : 'bg-averis-amber/10 text-averis-amber'}`}>
                {method}
              </span>
              <div>
                <code className="font-mono text-[10px] text-averis-text">{path}</code>
                <div className="font-mono text-[9px] text-averis-muted mt-0.5">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
