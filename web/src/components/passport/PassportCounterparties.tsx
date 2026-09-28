import { usePassportCounterparties } from '../../hooks/usePassport'

interface Props { address: string }

export function PassportCounterparties({ address }: Props) {
  const { data, status } = usePassportCounterparties(address)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">COUNTERPARTIES</h2>
        <p className="font-mono text-[9px] text-averis-muted/60 mt-1">Agents and services this address has transacted with.</p>
      </div>

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading...</p>}
      {status === 'error'   && <p className="font-mono text-[11px] text-red-400">Failed to load counterparties.</p>}

      {status === 'ok' && (
        data.length > 0 ? (
          <div className="space-y-2">
            <p className="font-mono text-[9px] text-averis-muted">{data.length} counterpart{data.length === 1 ? 'y' : 'ies'}</p>
            {data.map((cp: any, i: number) => (
              <div key={i} className="bg-averis-card border border-averis-line rounded px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[10px] text-averis-text break-all">{cp.address}</p>
                  {cp.label && <p className="font-mono text-[9px] text-averis-muted">{cp.label}</p>}
                  {cp.type  && <p className="font-mono text-[9px] text-averis-muted/60">{cp.type}</p>}
                </div>
                <div className="text-right shrink-0">
                  {cp.interactionCount != null && (
                    <p className="font-mono text-[9px] text-averis-muted">{cp.interactionCount} interactions</p>
                  )}
                  {cp.lastInteraction && (
                    <p className="font-mono text-[9px] text-averis-muted/60">{new Date(cp.lastInteraction).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-averis-line rounded p-5">
            <p className="font-mono text-[11px] text-averis-muted">No counterparties recorded.</p>
            <p className="font-mono text-[10px] text-averis-muted/60 mt-1">Counterparties are recorded as agents complete transactions with other agents and services.</p>
          </div>
        )
      )}
    </div>
  )
}
