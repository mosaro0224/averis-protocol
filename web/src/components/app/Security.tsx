import { CONTRACTS } from '../../lib/constants'

const CHECKS = [
  { label: 'Reentrancy Guards', status: 'pass', detail: 'nonReentrant on draw(), receivePayout(), repayObligation()' },
  { label: 'Pool Isolation', status: 'pass', detail: 'Each draw deploys a new AverisJobPool contract' },
  { label: 'Lien Enforcement', status: 'pass', detail: 'ReceivableRouter enforces repayment routing' },
  { label: 'Hood Limits', status: 'pass', detail: 'Per-agent credit limits enforced via AverisHood' },
  { label: 'Balance-Diff Sweep', status: 'pass', detail: 'Repayment uses balance-diff to prevent fee double-counting' },
  { label: 'Third-Party Audit', status: 'pending', detail: 'Not yet completed — testnet only' },
  { label: 'Formal Verification', status: 'pending', detail: 'Not started' },
  { label: 'Gnosis Safe Treasury', status: 'pending', detail: 'Currently EOA — required before mainnet' },
]

export function Security() {
  return (
    <div className="w-full px-8 py-8 space-y-8">
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-3">PROTOCOL SECURITY</div>
        <h2 className="font-display text-[28px] font-bold text-averis-text mb-2">Security</h2>
        <div className="border border-averis-amber/30 bg-averis-amber/5 px-5 py-4 mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[9px] tracking-[0.1em] text-averis-amber">TESTNET ONLY</span>
          </div>
          <p className="font-mono text-[10px] text-averis-muted2">
            These contracts have not been audited by a third party. Do not use with real funds.
            Mainnet deployment requires a completed external audit.
          </p>
        </div>
      </div>

      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">SECURITY CHECKS</div>
        <div className="border border-averis-line">
          {CHECKS.map((c, i) => (
            <div key={c.label} className={`flex items-start justify-between px-5 py-4 ${i > 0 ? 'border-t border-averis-line' : ''}`}>
              <div>
                <div className="font-mono text-[11px] text-averis-text mb-0.5">{c.label}</div>
                <div className="font-mono text-[9px] text-averis-muted">{c.detail}</div>
              </div>
              <span className={`font-mono text-[9px] px-2 py-0.5 shrink-0 ml-4 ${
                c.status === 'pass' ? 'bg-averis-green/10 text-averis-green' : 'bg-averis-amber/10 text-averis-amber'
              }`}>
                {c.status === 'pass' ? 'PASS' : 'PENDING'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">CONTRACT OWNERSHIP</div>
        <div className="border border-averis-line p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-averis-muted">Owner</span>
            <span className="font-mono text-[10px] text-averis-text">{CONTRACTS.vault.slice(0, 10)}…{CONTRACTS.vault.slice(-6)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-averis-muted">Treasury</span>
            <span className="font-mono text-[10px] text-averis-amber">EOA — replace with Gnosis Safe before mainnet</span>
          </div>
        </div>
      </div>
    </div>
  )
}
