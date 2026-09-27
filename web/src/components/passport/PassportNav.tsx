export type PassportTab =
  | 'overview' | 'identity' | 'capabilities' | 'authorization'
  | 'reputation' | 'risk' | 'agreements' | 'transactions'
  | 'counterparties' | 'receipts'

const TABS: { id: PassportTab; label: string }[] = [
  { id: 'overview',       label: 'OVERVIEW' },
  { id: 'identity',       label: 'IDENTITY' },
  { id: 'capabilities',   label: 'CAPABILITIES' },
  { id: 'authorization',  label: 'AUTHORIZATION' },
  { id: 'reputation',     label: 'REPUTATION' },
  { id: 'risk',           label: 'RISK' },
  { id: 'agreements',     label: 'AGREEMENTS' },
  { id: 'transactions',   label: 'TRANSACTIONS' },
  { id: 'counterparties', label: 'COUNTERPARTIES' },
  { id: 'receipts',       label: 'RECEIPTS' },
]

interface Props {
  active: PassportTab
  onChange: (tab: PassportTab) => void
}

export function PassportNav({ active, onChange }: Props) {
  return (
    <div className="border-b border-averis-line">
      <div className="w-full px-8 flex items-center gap-0 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={[
              'px-4 py-3 font-mono text-[9px] tracking-[0.14em] whitespace-nowrap transition-colors border-b-2 bg-transparent cursor-pointer',
              active === t.id
                ? 'border-blue-400 text-blue-400'
                : 'border-transparent text-averis-muted hover:text-averis-text2',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
