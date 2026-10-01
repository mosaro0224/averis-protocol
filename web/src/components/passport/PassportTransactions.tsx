import { useState } from 'react'
import { useAccount } from 'wagmi'
import { usePassportTransactions } from '../../hooks/usePassport'

interface Props { address: string }

const TX_TYPES   = ['','FINANCING','CREDIT_REPAYMENT','DEFAULT','JOB_PAYMENT','ESCROW','PAYMENT','API_PURCHASE','COMPUTE_PURCHASE','AGENT_TO_AGENT','TRADING','OTHER']
const TX_STATUSES = ['','active','completed','failed','disputed']

const TYPE_COLOR: Record<string, string> = {
  FINANCING:         'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  CREDIT_REPAYMENT:  'text-blue-400   bg-blue-400/10   border-blue-400/20',
  DEFAULT:           'text-red-400    bg-red-400/10    border-red-400/20',
  JOB_PAYMENT:       'text-purple-400 bg-purple-400/10 border-purple-400/20',
}

const STATUS_COLOR: Record<string, string> = {
  active:    'text-blue-400',
  completed: 'text-emerald-400',
  failed:    'text-red-400',
  disputed:  'text-amber-400',
}

const EXPLORER = 'https://explorer.testnet.arc.io/tx/'

export function PassportTransactions({ address }: Props) {
  const { address: connectedWallet } = useAccount()
  const [typeFilter,   setTypeFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // If viewing own wallet and connected, use connected address; otherwise use passport lookup address
  const effectiveAddress = address || connectedWallet || ''

  const { data, status } = usePassportTransactions(effectiveAddress, {
    type:   typeFilter   || undefined,
    status: statusFilter || undefined,
  })

  const isOwnWallet = connectedWallet && effectiveAddress.toLowerCase() === connectedWallet.toLowerCase()

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">TRANSACTIONS</h2>
          {isOwnWallet && (
            <p className="font-mono text-[9px] text-averis-green mt-1">Showing your onchain activity</p>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="font-mono text-[10px] text-white bg-[#1a1a1a] border border-[#444] rounded px-2 py-1 cursor-pointer focus:outline-none focus:border-blue-400"
          >
            {TX_TYPES.map(t => <option key={t} value={t}>{t || 'All types'}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="font-mono text-[10px] text-white bg-[#1a1a1a] border border-[#444] rounded px-2 py-1 cursor-pointer focus:outline-none focus:border-blue-400"
          >
            {TX_STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>
      </div>

      {status === 'loading' && (
        <p className="font-mono text-[11px] text-averis-muted animate-pulse">Loading transactions…</p>
      )}
      {status === 'error' && (
        <p className="font-mono text-[11px] text-red-400">Failed to load transactions.</p>
      )}

      {status === 'ok' && (
        data?.items?.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] text-averis-muted">{data.total} transaction{data.total !== 1 ? 's' : ''}</p>
              {data.indexed_at && (
                <p className="font-mono text-[9px] text-averis-muted/50">Indexed {new Date(data.indexed_at).toLocaleTimeString()}</p>
              )}
            </div>
            {data.items.map((tx: any) => (
              <div
                key={tx.id}
                className="bg-averis-card border border-averis-line rounded px-4 py-3 flex items-center gap-4 hover:border-averis-muted/40 transition-colors"
              >
                {/* Type badge */}
                <span className={`font-mono text-[9px] px-2 py-0.5 rounded border shrink-0 ${TYPE_COLOR[tx.type] ?? 'text-averis-muted bg-averis-bg border-averis-line'}`}>
                  {tx.type}
                </span>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-mono text-[9px] ${STATUS_COLOR[tx.status] ?? 'text-averis-muted'}`}>
                      {tx.status?.toUpperCase()}
                    </span>
                    {tx.jobId && (
                      <span className="font-mono text-[9px] text-averis-muted">Job #{tx.jobId}</span>
                    )}
                  </div>
                  {tx.counterparty && (
                    <p className="font-mono text-[9px] text-averis-muted truncate">
                      {tx.counterparty.slice(0, 10)}…{tx.counterparty.slice(-6)}
                    </p>
                  )}
                  {tx.block && (
                    <p className="font-mono text-[9px] text-averis-muted/50">Block {Number(tx.block).toLocaleString()}</p>
                  )}
                </div>

                {/* Amount + tx link */}
                <div className="text-right shrink-0 space-y-0.5">
                  {tx.amount && (
                    <p className="font-mono text-[11px] text-averis-text">{tx.amount}</p>
                  )}
                  {tx.txHash && (
                    <a
                      href={`${EXPLORER}${tx.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[9px] text-averis-muted hover:text-averis-text transition-colors block"
                      title={tx.txHash}
                    >
                      {tx.txHash.slice(0, 10)}…↗
                    </a>
                  )}
                  {tx.timestamp && (
                    <p className="font-mono text-[9px] text-averis-muted/60">{new Date(tx.timestamp).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-averis-line rounded p-5">
            <p className="font-mono text-[11px] text-averis-muted">
              No transactions recorded{typeFilter || statusFilter ? ' matching filters' : ''}.
            </p>
            <p className="font-mono text-[10px] text-averis-muted/60 mt-1">
              {effectiveAddress
                ? 'Transactions appear here when this agent interacts with Averis Finance.'
                : 'Connect your wallet to see your transaction history.'}
            </p>
          </div>
        )
      )}
    </div>
  )
}
