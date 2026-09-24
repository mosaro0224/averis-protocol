interface Props {
  label: string
  sublabel?: string
  value: string
  subvalue?: string
  loading?: boolean
}

export function StatCard({ label, sublabel, value, subvalue, loading }: Props) {
  return (
    <div className="border border-averis-line bg-averis-panel px-5 py-4">
      <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted uppercase mb-1">
        {label}
      </div>
      {sublabel && (
        <div className="font-mono text-[8px] text-averis-muted2 mb-2">{sublabel}</div>
      )}
      {loading ? (
        <div className="h-7 w-24 bg-averis-line animate-pulse rounded" />
      ) : (
        <div className="font-display text-[22px] font-semibold text-averis-text tabular-nums">
          {value}
        </div>
      )}
      {subvalue && (
        <div className="font-mono text-[9px] text-averis-muted mt-0.5">{subvalue}</div>
      )}
    </div>
  )
}
