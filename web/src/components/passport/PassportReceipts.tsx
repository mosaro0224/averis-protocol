import { usePassportReceipts } from '../../hooks/usePassport'
import { PASSPORT_CONTRACTS } from '../../lib/passportConstants'

interface Props { address: string }

const VSTATE_COLOR: Record<string, string> = {
  SELF_REPORTED:    'text-averis-muted',
  AVERIS_VERIFIED:  'text-blue-400',
  EXTERNAL_ATTESTER: 'text-emerald-400',
}

export function PassportReceipts({ address }: Props) {
  const { data, status } = usePassportReceipts(address)
  const contractDeployed = Boolean(PASSPORT_CONTRACTS.receiptRegistry)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">ECONOMIC RECEIPTS</h2>
        <p className="font-mono text-[9px] text-averis-muted/60 mt-1">Verifiable onchain anchors for economic events. Append-only. No raw data stored onchain.</p>
      </div>

      {!contractDeployed && (
        <div className="border border-amber-400/30 rounded p-4">
          <p className="font-mono text-[10px] text-amber-400">AgentReceiptRegistry deploying to Robinhood Chain Testnet.</p>
        </div>
      )}

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading...</p>}
      {status === 'error'   && <p className="font-mono text-[11px] text-red-400">Failed to load receipts.</p>}

      {status === 'ok' && (
        <>
          {data?.onchain?.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase">{data.onchain.length} Onchain Anchors</h3>
              {data.onchain.map((r: any) => (
                <div key={r.receiptId} className="bg-averis-card border border-averis-line rounded p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-averis-text">Receipt #{r.receiptId} — {r.receiptType}</span>
                    <span className={`font-mono text-[9px] ${VSTATE_COLOR[r.verificationState] ?? 'text-averis-muted'}`}>
                      {r.verificationState?.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Tx hash"     value={r.txHash?.slice(0, 18) + '…'} />
                    <Field label="Anchored at" value={r.anchoredAt ? new Date(r.anchoredAt * 1000).toLocaleDateString() : '-'} />
                    <Field label="Issuer"      value={r.issuer ? r.issuer.slice(0, 10) + '…' + r.issuer.slice(-6) : '-'} />
                    <Field label="Evidence"    value={r.evidenceHash?.slice(0, 18) + '…'} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {(data?.offchain?.length ?? 0) > 0 && (
            <div className="space-y-3">
              <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase">{data.offchain.length} Offchain Records</h3>
              {data.offchain.map((r: any, i: number) => (
                <div key={i} className="border border-averis-line/40 rounded p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-averis-text">{r.label ?? `Record ${i + 1}`}</span>
                    <span className={`font-mono text-[9px] ${VSTATE_COLOR[r.verificationState] ?? 'text-averis-muted'}`}>
                      {(r.verificationState ?? 'SELF_REPORTED').replace('_', ' ')}
                    </span>
                  </div>
                  {r.description && <p className="font-mono text-[9px] text-averis-muted">{r.description}</p>}
                </div>
              ))}
            </div>
          )}

          {(data?.onchain?.length ?? 0) === 0 && (data?.offchain?.length ?? 0) === 0 && (
            <div className="border border-averis-line rounded p-5 space-y-2">
              <p className="font-mono text-[11px] text-averis-muted">No receipts recorded.</p>
              <p className="font-mono text-[10px] text-averis-muted/60">
                Receipts are anchored as agents complete economic events. The onchain anchor is a hash of the event; raw data is stored offchain.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <p className="font-mono text-[9px] text-averis-muted">{label}</p>
      <p className="font-mono text-[9px] text-averis-text">{value}</p>
    </div>
  )
}
