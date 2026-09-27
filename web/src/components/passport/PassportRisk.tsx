import { usePassportRisk } from '../../hooks/usePassport'

interface Props { address: string }

const TIER_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  UNRATED:          { label: 'UNRATED',          color: 'text-averis-muted',  description: 'No credit activity. Not yet eligible or evaluated.' },
  ELIGIBLE:         { label: 'ELIGIBLE',          color: 'text-emerald-400',  description: 'Credit limit set and available. Zero current exposure.' },
  ACTIVE:           { label: 'ACTIVE',            color: 'text-blue-400',     description: 'Active financing with exposure below 50% of limit.' },
  HIGH_UTILIZATION: { label: 'HIGH UTILIZATION',  color: 'text-amber-400',    description: 'Exposure between 50-100% of effective credit limit.' },
  AT_LIMIT:         { label: 'AT LIMIT',          color: 'text-red-400',      description: 'Exposure has reached the effective credit ceiling.' },
}

export function PassportRisk({ address }: Props) {
  const { data, status } = usePassportRisk(address)

  const tier   = data?.riskTier ?? 'UNRATED'
  const cfg    = TIER_CONFIG[tier] ?? TIER_CONFIG.UNRATED

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">RISK PROFILE</h2>
        <p className="font-mono text-[9px] text-averis-muted/60 mt-1">Derived from live Averis Bank contract state on Arc Testnet.</p>
      </div>

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading risk data...</p>}
      {status === 'error'   && <p className="font-mono text-[11px] text-red-400">Failed to load risk profile.</p>}

      {status === 'ok' && (
        <>
          {/* Tier banner */}
          <div className={`bg-averis-card border border-averis-line rounded p-5 space-y-2`}>
            <div className="flex items-center gap-3">
              <span className={`font-mono text-[14px] ${cfg.color}`}>{cfg.label}</span>
              {data?.hoodPaused && (
                <span className="font-mono text-[9px] text-amber-400 border border-amber-400/30 rounded px-2 py-0.5">HOOD PAUSED</span>
              )}
            </div>
            <p className="font-mono text-[10px] text-averis-muted">{cfg.description}</p>
          </div>

          {data?.available && (
            <>
              {/* Credit capacity */}
              <div className="bg-averis-card border border-averis-line rounded p-5 space-y-3">
                <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase">Credit Capacity</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Credit limit"     value={data.creditLimit > 0 ? `${(data.creditLimit / 1e6).toFixed(2)} USDC` : 'Protocol max'} />
                  <Stat label="Exposure"         value={`${(data.exposure / 1e6).toFixed(2)} USDC`} />
                  <Stat label="Available"        value={`${(data.availableCredit / 1e6).toFixed(2)} USDC`} highlight />
                  <Stat label="Effective cap"    value={`${(data.effectiveCap / 1e6).toFixed(2)} USDC`} />
                </div>

                {/* Utilization bar */}
                {data.effectiveCap > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="font-mono text-[9px] text-averis-muted">Utilization</span>
                      <span className="font-mono text-[9px] text-averis-text">
                        {(data.exposure / data.effectiveCap * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-averis-line rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all ${tier === 'HIGH_UTILIZATION' ? 'bg-amber-400' : tier === 'AT_LIMIT' ? 'bg-red-400' : 'bg-blue-400'}`}
                        style={{ width: `${Math.min(100, data.exposure / data.effectiveCap * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Financing terms */}
              <div className="bg-averis-card border border-averis-line rounded p-5 space-y-3">
                <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase">Financing Terms</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Advance rate"     value={`${(data.advanceRateBps / 100).toFixed(2)}%`} />
                  <Stat label="Financing fee"    value={`${(data.feeBps / 100).toFixed(2)}%`} />
                  <Stat label="Protocol max"     value={`${(data.protocolMaximum / 1e6).toFixed(2)} USDC`} />
                  <Stat label="Vault TVL"        value={`${(data.vaultTotalAssets / 1e6).toFixed(2)} USDC`} />
                </div>
              </div>

              {/* Risk factors */}
              {data.riskFactors && (
                <div className="bg-averis-card border border-averis-line rounded p-5 space-y-2">
                  <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase mb-3">Contributing Factors</h3>
                  {data.riskFactors.map((f: any, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-4 py-2 border-b border-averis-line/40 last:border-0">
                      <div>
                        <p className="font-mono text-[10px] text-averis-text">{f.factor}</p>
                        <p className="font-mono text-[9px] text-averis-muted/60">{f.notes}</p>
                      </div>
                      <span className="font-mono text-[10px] text-averis-text shrink-0">{String(f.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {!data?.available && (
            <div className="border border-averis-line rounded p-5 space-y-2">
              <p className="font-mono text-[11px] text-averis-muted">Averis Bank contract data unavailable.</p>
              <p className="font-mono text-[9px] text-averis-muted/60">{data?.note ?? 'Check API health.'}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-[9px] text-averis-muted uppercase">{label}</p>
      <p className={`font-mono text-[12px] ${highlight ? 'text-emerald-400' : 'text-averis-text'}`}>{value}</p>
    </div>
  )
}
