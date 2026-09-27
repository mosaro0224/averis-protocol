import { useState } from 'react'
import { usePassportTransactions } from '../../hooks/usePassport'

interface Props { address: string }

const TX_TYPES = ['','JOB_PAYMENT','FINANCING','CREDIT_REPAYMENT','ESCROW','PAYMENT','API_PURCHASE','COMPUTE_PURCHASE','AGENT_TO_AGENT','TRADING','OTHER']
const TX_STATUSES = ['','active','completed','failed','disputed']

const STATUS_COLOR: Record<string, string> = {
  active:    'text-blue-400',
  completed: 'text-emerald-400',
  failed:    'text-red-400',
  disputed:  'text-amber-400',
}

export function PassportTransactions({ address }: Props) {
  const [typeFilter,   setTypeFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const { data, status } = usePassportTransactions(address, {
    type:   typeFilter   || undefined,
    status: statusFilter || undefined,
  })

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">TRANSACTIONS</h2>
        <div className="flex gap-2">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="font-mono text-[10px] text-averis-text bg-averis-card border border-averis-line rounded px-2 py-1 cursor-pointer"
          >
            {TX_TYPES.map(t => <option key={t} value={t}>{t || 'All types'}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="font-mono text-[10px] text-averis-text bg-averis-card border border-averis-line rounded px-2 py-1 cursor-pointer"
          >
            {TX_STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>
      </div>

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading...</p>}
      {status === 'error'   && <p className="font-mono text-[11px] text-red-400">Failed to load transactions.</p>}

      {status === 'ok' && (
        data?.items?.length > 0 ? (
          <div className="space-y-2">
            <p className="font-mono text-[9px] text-averis-muted">{data.total} total</p>
            {data.items.map((tx: any) => (
              <div key={tx.id} className="bg-averis-card border border-averis-line rounded px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[10px] text-averis-text">{tx.type}</span>
                    <span className={`font-mono text-[9px] ${STATUS_COLOR[tx.status] ?? 'text-averis-muted'}`}>
                      {tx.status?.toUpperCase()}
                    </span>
                  </div>
                  {tx.counterparty && (
                    <p className="font-mono text-[9px] text-averis-muted truncate">
                      Counterparty: {tx.counterparty.slice(0, 10)}…{tx.counterparty.slice(-6)}
                    </p>
                  )}
                  {tx.txHash && (
                    <p className="font-mono text-[9px] text-averis-muted/60 truncate">{tx.txHash.slice(0, 18)}…</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {tx.amount && (
                    <p className="font-mono text-[11px] text-averis-text">{tx.amount}</p>
                  )}
                  {tx.timestamp && (
                    <p className="font-mono text-[9px] text-averis-muted">{new Date(tx.timestamp).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-averis-line rounded p-5">
            <p className="font-mono text-[11px] text-averis-muted">No transactions recorded{typeFilter || statusFilter ? ' matching filters' : ''}.</p>
            <p className="font-mono text-[10px] text-averis-muted/60 mt-1">Transactions are recorded as agents interact with Averis Bank and registered protocols.</p>
          </div>
        )
      )}
    </div>
  )
}
