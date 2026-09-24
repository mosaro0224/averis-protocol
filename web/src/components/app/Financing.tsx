import { useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { CONTRACTS, API_BASE, USDC_DECIMALS } from '../../lib/constants'
import { FINANCING_ABI } from '../../lib/abis'

export function Financing() {
  const { address } = useAccount()
  const { data: advanceRate } = useReadContract({ address: CONTRACTS.financing, abi: FINANCING_ABI, functionName: 'advanceRateBps' })
  const { data: feeBps } = useReadContract({ address: CONTRACTS.financing, abi: FINANCING_ABI, functionName: 'feeBps' })

  // External job state
  const [extPlatform, setExtPlatform] = useState('')
  const [extJobId, setExtJobId]     = useState('0')
  const [extAmount, setExtAmount]   = useState('0.00')
  const [extResult, setExtResult]   = useState('')
  const [extLoading, setExtLoading] = useState(false)

  async function checkEligibility() {
    if (!address) { setExtResult('Connect wallet first.'); return }
    setExtLoading(true)
    setExtResult('')
    try {
      const res = await fetch(`${API_BASE}/v1/agents/${address}/eligibility`, { cache: 'no-store' })
      const json = await res.json()
      setExtResult(JSON.stringify(json, null, 2))
    } catch (e: unknown) {
      setExtResult('Error: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExtLoading(false)
    }
  }

  async function drawExternal() {
    setExtResult('Use AverisFinancingV2.draw(1, platformAddr, jobId, amount, sig, recipients) via your wallet or agent SDK.')
  }

  const adv = advanceRate !== undefined ? Number(advanceRate) / 100 : 40
  const fee = feeBps !== undefined ? Number(feeBps) / 100 : 2

  return (
    <div className="max-w-[1180px] mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="#9cf57d" strokeWidth="1.5"/>
            <path d="M5 8h6M8 5v6" stroke="#9cf57d" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="font-mono text-[9px] tracking-[0.14em] text-averis-muted">JOB-SPECIFIC SPENDING POOLS</span>
        </div>
        <h2 className="font-display text-[28px] font-bold text-averis-text mb-2">Financing</h2>
        <p className="text-[14px] text-averis-muted2 max-w-[520px]">
          Draw financing against a funded job. Capital is deployed to a controlled spending pool, not your wallet.
        </p>
      </div>

      {/* Protocol stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-averis-line border border-averis-line">
        {[
          ['ADVANCE RATE', `${adv}%`],
          ['FINANCING FEE', `${fee.toFixed(2)}%`],
          ['CAPITAL DESTINATION', 'Job Spending Pool'],
          ['REPAYMENT', 'Via Receivable Lien'],
        ].map(([label, value]) => (
          <div key={label} className="p-4 md:border-r border-averis-line last:border-r-0">
            <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-2">{label}</div>
            <div className="font-mono text-[13px] text-averis-text">{value}</div>
          </div>
        ))}
      </div>

      {/* Financing flow */}
      <div className="border border-averis-line bg-averis-panel px-5 py-4">
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-3">FINANCING FLOW</div>
        <div className="font-mono text-[11px] text-averis-muted2">
          Verify Job → Set Allowed Recipients → Draw (creates pool) → Spend from Pool → Settlement repays vault
        </div>
      </div>

      {/* ACP Jobs list */}
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">YOUR ACP JOBS</div>
        {!address ? (
          <div className="border border-dashed border-averis-line p-12 text-center">
            <div className="font-mono text-[10px] text-averis-muted">CONNECT A WALLET TO VIEW ELIGIBLE JOBS</div>
          </div>
        ) : (
          <div className="border border-dashed border-averis-line p-12 text-center">
            <div className="font-mono text-[10px] text-averis-muted mb-2">NO JOBS FOUND</div>
            <div className="text-[12px] text-averis-muted2">No jobs have been created in the ACP escrow yet.</div>
          </div>
        )}
      </div>

      {/* External Job Financing */}
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">EXTERNAL JOB FINANCING</div>
        <div className="border border-averis-line p-5 space-y-4">
          <p className="font-mono text-[10px] text-averis-muted2 leading-relaxed">
            Finance a job on an external whitelisted platform. Averis tries LIEN mode first and falls back to OBLIGATION
            if the platform does not support setPayoutReceiver. Uses ExternalJobAdapter (adapterId=1).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-1.5">PLATFORM CONTRACT ADDRESS</label>
              <input
                type="text"
                value={extPlatform}
                onChange={e => setExtPlatform(e.target.value)}
                placeholder="0x..."
                className="w-full bg-averis-bg border border-averis-line focus:border-averis-linemid outline-none font-mono text-[11px] text-averis-text placeholder:text-averis-muted2 px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-1.5">JOB ID</label>
              <input
                type="number"
                value={extJobId}
                onChange={e => setExtJobId(e.target.value)}
                className="w-full bg-averis-bg border border-averis-line focus:border-averis-linemid outline-none font-mono text-[11px] text-averis-text placeholder:text-averis-muted2 px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-1.5">AMOUNT TO DRAW (USDC)</label>
            <input
              type="number"
              step="0.01"
              value={extAmount}
              onChange={e => setExtAmount(e.target.value)}
              className="w-full bg-averis-bg border border-averis-line focus:border-averis-linemid outline-none font-mono text-[11px] text-averis-text px-3 py-2"
            />
            <div className="font-mono text-[9px] text-averis-muted mt-1">
              Max: {adv}% of job budget. Fee: {fee.toFixed(2)}% at repayment.
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={checkEligibility}
              disabled={extLoading}
              className="font-mono text-[10px] tracking-[0.06em] border border-averis-line text-averis-text px-4 py-2 bg-transparent hover:border-averis-linemid transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {extLoading ? 'CHECKING…' : 'CHECK ELIGIBILITY'}
            </button>
            <button
              onClick={drawExternal}
              className="font-mono text-[10px] tracking-[0.06em] bg-averis-green text-averis-greendark font-bold px-4 py-2 border-0 hover:bg-[#b3fa99] transition-colors cursor-pointer"
            >
              DRAW FUNDS →
            </button>
          </div>

          {extResult && (
            <pre className="font-mono text-[10px] text-averis-muted bg-averis-bg border border-averis-line p-3 min-h-[40px] whitespace-pre-wrap break-all">
              {extResult}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
