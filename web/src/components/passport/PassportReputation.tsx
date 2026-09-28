import { usePassportReputation } from '../../hooks/usePassport'

interface Props { address: string }

function EvidenceRow({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-averis-line/40 last:border-0">
      <div className="flex-1">
        <p className="font-mono text-[10px] text-averis-text">{label}</p>
        {note && <p className="font-mono text-[9px] text-averis-muted/60 mt-0.5">{note}</p>}
      </div>
      <span className="font-mono text-[12px] text-averis-text shrink-0">{value}</span>
    </div>
  )
}

export function PassportReputation({ address }: Props) {
  const { data, status } = usePassportReputation(address)
  const ev = data?.evidence

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">REPUTATION EVIDENCE</h2>
        <p className="font-mono text-[9px] text-averis-muted/60 mt-1">Evidence-based. Not a score. Each dimension is independently verifiable.</p>
      </div>

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading...</p>}
      {status === 'error'   && <p className="font-mono text-[11px] text-red-400">Failed to load reputation data.</p>}

      {status === 'ok' && ev && (
        <>
          <div className="bg-averis-card border border-averis-line rounded p-5">
            <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase mb-3">Job History</h3>
            <EvidenceRow label="Jobs completed"  value={ev.jobsCompleted  ?? 0} note="Payments received for completed jobs" />
            <EvidenceRow label="Jobs failed"     value={ev.jobsFailed     ?? 0} note="Jobs that ended with failed status" />
            <EvidenceRow label="Jobs disputed"   value={ev.jobsDisputed   ?? 0} note="Jobs in active or resolved dispute" />
            <EvidenceRow label="Payments sent"   value={ev.paymentsCompleted ?? 0} note="Agent-initiated outgoing payments" />
          </div>

          <div className="bg-averis-card border border-averis-line rounded p-5">
            <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase mb-3">Financing History</h3>
            <EvidenceRow label="Financing repaid"        value={ev.financingRepaid       ?? 0} note="Fully repaid Averis Bank positions" />
            <EvidenceRow label="Outstanding obligations" value={ev.outstandingObligations ?? 0} note="Active financing positions" />
          </div>

          <div className="bg-averis-card border border-averis-line rounded p-5">
            <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase mb-3">Network</h3>
            <EvidenceRow label="Known counterparties" value={ev.counterpartyCount ?? 0} note="Distinct agents/services interacted with" />
            <EvidenceRow label="Receipts anchored"    value={ev.receiptCount      ?? 0} note="Onchain economic receipt anchors" />
            <EvidenceRow label="Verified receipts"    value={ev.verifiedReceipts  ?? 0} note="Averis-verified receipt anchors" />
            <EvidenceRow label="External attestations" value={ev.attestations     ?? 0} note="Third-party issuer attestations" />
          </div>

          {ev.averisCredit && (
            <div className="bg-averis-card border border-averis-line rounded p-5">
              <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase mb-3">Averis Credit History</h3>
              <EvidenceRow label="Risk tier"       value={ev.averisCredit.riskTier}                       note="Evidence-based risk classification" />
              <EvidenceRow label="Credit limit"    value={ev.averisCredit.creditLimit > 0 ? `${(ev.averisCredit.creditLimit / 1e6).toFixed(2)} USDC` : 'Protocol max'} />
              <EvidenceRow label="Credit available" value={`${(ev.averisCredit.available / 1e6).toFixed(2)} USDC`} />
              <EvidenceRow label="Exposure"        value={`${(ev.averisCredit.exposure  / 1e6).toFixed(2)} USDC`} />
            </div>
          )}

          {/* All zero state */}
          {ev.jobsCompleted === 0 && ev.jobsFailed === 0 && ev.receiptCount === 0 && (
            <div className="border border-averis-line/40 rounded p-4">
              <p className="font-mono text-[10px] text-averis-muted">No economic activity recorded yet for this address.</p>
              <p className="font-mono text-[9px] text-averis-muted/60 mt-1">As this agent completes jobs and transactions, evidence will accumulate here.</p>
            </div>
          )}
        </>
      )}

      <div className="border border-averis-line/40 rounded p-4">
        <p className="font-mono text-[9px] text-averis-muted/60">
          Reputation evidence is derived from onchain events (Averis Bank positions) and offchain records (transactions, receipts).
          Counterparties and receipt metadata are stored in Averis Passport offchain store. Onchain anchors come from AgentReceiptRegistry.
        </p>
      </div>
    </div>
  )
}
