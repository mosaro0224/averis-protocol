export function Pools() {
  return (
    <div className="w-full px-8 py-8 space-y-8">
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-3">JOB SPENDING POOLS</div>
        <h2 className="font-display text-[28px] font-bold text-averis-text mb-2">Pools</h2>
        <p className="text-[14px] text-averis-muted2 max-w-[520px]">
          Each draw creates an isolated spending pool. Capital flows only to whitelisted recipients for the duration of the job.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-averis-line border border-averis-line">
        {[
          ['ISOLATED', 'Each pool is deployed per job. No cross-contamination between positions.'],
          ['PERMISSIONED', 'Only approved recipients can receive capital from a pool.'],
          ['TIME-BOUNDED', 'Pool freezes at job expiry. Remaining funds return to vault.'],
        ].map(([label, desc]) => (
          <div key={label} className="bg-averis-panel p-5">
            <div className="font-mono text-[9px] tracking-[0.14em] text-averis-green mb-2">{label}</div>
            <div className="text-[13px] text-averis-muted2">{desc}</div>
          </div>
        ))}
      </div>

      <div className="border border-dashed border-averis-line p-16 text-center">
        <div className="font-mono text-[10px] text-averis-muted mb-2">NO ACTIVE POOLS</div>
        <div className="text-[12px] text-averis-muted2">Active job pools will appear here once financing is drawn.</div>
      </div>
    </div>
  )
}
