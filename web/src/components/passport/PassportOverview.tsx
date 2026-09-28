import { usePassportProfile } from '../../hooks/usePassport'
import type { PassportTab } from './PassportNav'

interface Props {
  address: string
  onNav: (tab: PassportTab) => void
}

function RiskBadge({ tier }: { tier?: string }) {
  if (!tier || tier === 'UNRATED') return <span className="font-mono text-[10px] text-averis-muted">UNRATED</span>
  const map: Record<string, string> = {
    ELIGIBLE:         'text-emerald-400',
    ACTIVE:           'text-blue-400',
    HIGH_UTILIZATION: 'text-amber-400',
    AT_LIMIT:         'text-red-400',
  }
  return <span className={`font-mono text-[10px] ${map[tier] ?? 'text-averis-muted'}`}>{tier.replace('_', ' ')}</span>
}

function SummaryCard({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`bg-averis-card border border-averis-line rounded p-4 flex flex-col gap-1 text-left w-full ${onClick ? 'hover:border-blue-400/40 cursor-pointer transition-colors' : 'cursor-default'}`}
    >
      <span className="font-mono text-[9px] tracking-widest text-averis-muted uppercase">{label}</span>
      <span className="font-mono text-xl text-averis-text">{value}</span>
      {sub && <span className="font-mono text-[9px] text-averis-muted">{sub}</span>}
    </button>
  )
}

export function PassportOverview({ address, onNav }: Props) {
  const { data, status, error } = usePassportProfile(address)

  if (status === 'loading') return (
    <div className="p-8 font-mono text-[11px] text-averis-muted">Loading passport...</div>
  )

  if (status === 'error') return (
    <div className="p-8 font-mono text-[11px] text-red-400">Failed to load passport: {error}</div>
  )

  const s = data?.summary ?? {}
  const averis = data?.averisBank

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted mb-1">AGENT ECONOMIC PASSPORT</h2>
        <p className="font-mono text-[10px] text-averis-muted/60 break-all">{address}</p>
      </div>

      {/* Risk tier */}
      {averis?.available && (
        <div className="flex items-center gap-3 bg-averis-card border border-averis-line rounded p-4">
          <span className="font-mono text-[9px] text-averis-muted">RISK TIER</span>
          <RiskBadge tier={s.riskTier} />
          {averis.availableCredit != null && (
            <>
              <span className="font-mono text-[9px] text-averis-muted ml-4">CREDIT AVAILABLE</span>
              <span className="font-mono text-[10px] text-averis-text">{(averis.availableCredit / 1e6).toFixed(2)} USDC</span>
              <span className="font-mono text-[9px] text-averis-muted ml-4">EXPOSURE</span>
              <span className="font-mono text-[10px] text-averis-text">{(averis.exposure / 1e6).toFixed(2)} USDC</span>
            </>
          )}
        </div>
      )}

      {/* Summary grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Identities"     value={s.identityCount     ?? 0} sub="across chains"   onClick={() => onNav('identity')} />
        <SummaryCard label="Capabilities"   value={s.capabilityCount   ?? 0} sub="declared"         onClick={() => onNav('capabilities')} />
        <SummaryCard label="Policies"       value={s.policyCount       ?? 0} sub="onchain EIP-712"  onClick={() => onNav('authorization')} />
        <SummaryCard label="Receipts"       value={s.receiptCount      ?? 0} sub="anchored onchain" onClick={() => onNav('receipts')} />
        <SummaryCard label="Counterparties" value={s.counterpartyCount ?? 0} sub="known parties"    onClick={() => onNav('counterparties')} />
      </div>

      {/* Averis Bank integration */}
      {averis?.available && (
        <div className="bg-averis-card border border-averis-line rounded p-5 space-y-3">
          <h3 className="font-mono text-[10px] tracking-[0.14em] text-averis-muted">AVERIS BANK</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Credit limit',    value: averis.creditLimit     > 0 ? `${(averis.creditLimit / 1e6).toFixed(2)} USDC` : 'Protocol max' },
              { label: 'Exposure',        value: `${(averis.exposure    / 1e6).toFixed(2)} USDC` },
              { label: 'Advance rate',    value: `${(averis.advanceRateBps / 100).toFixed(2)}%` },
              { label: 'Financing fee',   value: `${(averis.feeBps       / 100).toFixed(2)}%` },
            ].map(r => (
              <div key={r.label} className="space-y-1">
                <p className="font-mono text-[9px] text-averis-muted">{r.label}</p>
                <p className="font-mono text-[12px] text-averis-text">{r.value}</p>
              </div>
            ))}
          </div>
          {averis.hoodPaused && (
            <div className="border border-amber-400/40 rounded px-3 py-2">
              <span className="font-mono text-[10px] text-amber-400">HOOD PAUSED — Protocol circuit breaker active. No new financing.</span>
            </div>
          )}
        </div>
      )}

      {/* Reputation snapshot */}
      {data?.reputation && (
        <div className="bg-averis-card border border-averis-line rounded p-5 space-y-3">
          <h3 className="font-mono text-[10px] tracking-[0.14em] text-averis-muted">REPUTATION EVIDENCE</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Jobs completed',   value: data.reputation.jobsCompleted ?? 0 },
              { label: 'Jobs failed',      value: data.reputation.jobsFailed    ?? 0 },
              { label: 'Jobs disputed',    value: data.reputation.jobsDisputed  ?? 0 },
              { label: 'Financing repaid', value: data.reputation.financingRepaid ?? 0 },
            ].map(r => (
              <div key={r.label} className="space-y-1">
                <p className="font-mono text-[9px] text-averis-muted">{r.label}</p>
                <p className="font-mono text-[14px] text-averis-text">{r.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {status === 'ok' && !averis?.available && s.identityCount === 0 && (
        <div className="border border-averis-line rounded p-6 text-center space-y-2">
          <p className="font-mono text-[11px] text-averis-muted">No passport data for this address.</p>
          <p className="font-mono text-[10px] text-averis-muted/60">Register an ERC-8004 identity on Arc Testnet or Robinhood Chain Testnet to get started.</p>
        </div>
      )}
    </div>
  )
}
