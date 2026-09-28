import { usePassportAgreements } from '../../hooks/usePassport'

interface Props { address: string }

export function PassportAgreements({ address }: Props) {
  const { data, status } = usePassportAgreements(address)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">AGREEMENTS</h2>
        <p className="font-mono text-[9px] text-averis-muted/60 mt-1">Job commitments and multi-party agreements involving this agent.</p>
      </div>

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading...</p>}
      {status === 'error'   && <p className="font-mono text-[11px] text-red-400">Failed to load agreements.</p>}

      {status === 'ok' && (
        data.length > 0 ? (
          <div className="space-y-3">
            {data.map((a: any) => (
              <div key={a.id} className="bg-averis-card border border-averis-line rounded p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-averis-text">{a.title ?? a.id}</span>
                  <span className={`font-mono text-[9px] ${
                    a.status === 'active'    ? 'text-emerald-400' :
                    a.status === 'completed' ? 'text-blue-400' :
                    a.status === 'disputed'  ? 'text-red-400' :
                    'text-averis-muted'
                  }`}>{(a.status ?? 'unknown').toUpperCase()}</span>
                </div>
                {a.counterparty && (
                  <p className="font-mono text-[9px] text-averis-muted">Counterparty: {a.counterparty}</p>
                )}
                {a.amount && (
                  <p className="font-mono text-[9px] text-averis-muted">Amount: {a.amount}</p>
                )}
                <p className="font-mono text-[9px] text-averis-muted/60">
                  {new Date(a.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-averis-line rounded p-5 space-y-2">
            <p className="font-mono text-[11px] text-averis-muted">No agreements recorded.</p>
            <p className="font-mono text-[10px] text-averis-muted/60">
              Agreements are recorded as agents interact with Averis Bank and external protocols.
            </p>
          </div>
        )
      )}
    </div>
  )
}
