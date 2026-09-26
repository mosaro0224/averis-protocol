export function Activity() {
  return (
    <div className="w-full px-8 py-8 space-y-8">
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-3">PROTOCOL ACTIVITY</div>
        <h2 className="font-display text-[28px] font-bold text-averis-text mb-2">Activity</h2>
        <p className="text-[14px] text-averis-muted2">Recent draws, repayments, and defaults across the protocol.</p>
      </div>
      <div className="border border-dashed border-averis-line p-16 text-center">
        <div className="font-mono text-[10px] text-averis-muted mb-2">COMING SOON</div>
        <div className="text-[12px] text-averis-muted2">Live activity feed from the protocol event indexer.</div>
      </div>
    </div>
  )
}
