export type AppTab = 'overview' | 'agents' | 'financing' | 'pools' | 'vault' | 'security' | 'activity'

interface Props { active: AppTab; onChange: (tab: AppTab) => void }

const TABS: { id: AppTab; label: string; soon?: boolean }[] = [
  { id: 'overview',   label: 'OVERVIEW' },
  { id: 'agents',     label: 'AGENTS' },
  { id: 'financing',  label: 'FINANCING' },
  { id: 'pools',      label: 'POOLS' },
  { id: 'vault',      label: 'VAULT' },
  { id: 'security',   label: 'SECURITY' },
  { id: 'activity',   label: 'ACTIVITY', soon: true },
]

export function AppNav({ active, onChange }: Props) {
  return (
    <div className="flex border-b border-averis-line overflow-x-auto px-2">
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] px-5 py-4 border-b-2 transition-colors bg-transparent border-l-0 border-r-0 border-t-0 cursor-pointer whitespace-nowrap
            ${active === tab.id
              ? 'text-averis-green border-averis-green'
              : 'text-averis-muted border-transparent hover:text-averis-text'}`}
        >
          {tab.label}
          {tab.soon && (
            <span className="font-mono text-[7px] bg-averis-surface px-1 py-0.5 text-averis-muted border border-averis-line">
              SOON
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
