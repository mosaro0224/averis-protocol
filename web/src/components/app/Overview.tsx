import { useReadContract, useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { StatCard } from '../ui/StatCard'
import { ContractRow } from '../ui/ContractRow'
import { CONTRACTS, USDC_DECIMALS } from '../../lib/constants'
import { VAULT_ABI, FINANCING_ABI, HOOD_ABI } from '../../lib/abis'

export function Overview() {
  const { address } = useAccount()

  const { data: totalAssets, isLoading: l1 } = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'totalAssets' })
  const { data: available, isLoading: l2 } = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'availableLiquidity' })
  const { data: outstanding, isLoading: l3 } = useReadContract({ address: CONTRACTS.financing, abi: FINANCING_ABI, functionName: 'outstandingPrincipal' })
  const { data: advanceRate } = useReadContract({ address: CONTRACTS.financing, abi: FINANCING_ABI, functionName: 'advanceRateBps' })
  const { data: feeBps } = useReadContract({ address: CONTRACTS.financing, abi: FINANCING_ABI, functionName: 'feeBps' })
  const { data: vaultShares } = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'balanceOf', args: address ? [address] : undefined, query: { enabled: !!address } })
  const { data: suppliedAssets } = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'convertToAssets', args: vaultShares ? [vaultShares] : undefined, query: { enabled: !!vaultShares } })
  const { data: creditLimit } = useReadContract({ address: CONTRACTS.hood, abi: HOOD_ABI, functionName: 'creditLimit', args: address ? [address] : undefined, query: { enabled: !!address } })

  const fmt = (v: bigint | undefined) => v !== undefined ? `$${parseFloat(formatUnits(v, USDC_DECIMALS)).toFixed(2)}` : '—'
  const fmtShares = (v: bigint | undefined) => v !== undefined ? parseFloat(formatUnits(v, USDC_DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'
  const util = totalAssets && outstanding ? ((Number(outstanding) / Number(totalAssets)) * 100).toFixed(1) + '%' : '0.0%'

  return (
    <div className="max-w-[1180px] mx-auto px-6 py-8 space-y-8">
      {/* Protocol stats */}
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">PROTOCOL</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-averis-line border border-averis-line">
          <StatCard label="VAULT TVL" sublabel="Total assets managed" value={fmt(totalAssets)} loading={l1} />
          <StatCard label="AVAILABLE" sublabel="Ready to deploy" value={fmt(available)} loading={l2} />
          <StatCard label="UTILIZATION" sublabel="Outstanding / TVL" value={util} loading={l3} />
          <StatCard label="OUTSTANDING" sublabel="Deployed capital" value={fmt(outstanding)} loading={l3} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Financing parameters */}
        <div>
          <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">FINANCING PARAMETERS</div>
          <div className="border border-averis-line">
            <div className="flex items-center justify-between border-b border-averis-line px-5 py-4">
              <div>
                <div className="font-mono text-[10px] text-averis-text2">ADVANCE RATE</div>
                <div className="font-mono text-[8px] text-averis-muted mt-0.5">of job budget</div>
              </div>
              <span className="font-display text-[18px] font-semibold text-averis-text">
                {advanceRate !== undefined ? `${Number(advanceRate) / 100}%` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-averis-line px-5 py-4">
              <div>
                <div className="font-mono text-[10px] text-averis-text2">FINANCING FEE</div>
                <div className="font-mono text-[8px] text-averis-muted mt-0.5">charged at repayment</div>
              </div>
              <span className="font-display text-[18px] font-semibold text-averis-text">
                {feeBps !== undefined ? `${Number(feeBps) / 100}%` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="font-mono text-[10px] text-averis-text2">OUTSTANDING PRINCIPAL</div>
                <div className="font-mono text-[8px] text-averis-muted mt-0.5">deployed capital</div>
              </div>
              <span className="font-display text-[18px] font-semibold text-averis-text">{fmt(outstanding)}</span>
            </div>
          </div>
        </div>

        {/* Your position */}
        <div>
          <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">YOUR POSITION</div>
          {address ? (
            <div className="border border-averis-line">
              <div className="flex items-center justify-between border-b border-averis-line px-5 py-4">
                <span className="font-mono text-[10px] text-averis-muted">SUPPLIED LIQUIDITY</span>
                <span className="font-display text-[16px] font-semibold text-averis-text">{fmt(suppliedAssets)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-averis-line px-5 py-4">
                <span className="font-mono text-[10px] text-averis-muted">VAULT SHARES</span>
                <span className="font-mono text-[13px] text-averis-text">{fmtShares(vaultShares)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-4">
                <span className="font-mono text-[10px] text-averis-muted">AGENT CREDIT LIMIT</span>
                <span className="font-mono text-[13px] text-averis-text">{creditLimit !== undefined ? fmt(creditLimit) : '—'}</span>
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-averis-line p-10 text-center">
              <p className="font-mono text-[10px] text-averis-muted">Connect a wallet to view your position</p>
            </div>
          )}
        </div>
      </div>

      {/* Deployed contracts */}
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-4">DEPLOYED CONTRACTS</div>
        <div className="border border-averis-line">
          <ContractRow name="AverisVault"        address={CONTRACTS.vault} />
          <ContractRow name="AverisFinancing"    address={CONTRACTS.financing} />
          <ContractRow name="AverisACP"          address={CONTRACTS.acp} />
          <ContractRow name="ReceivableRouter"   address={CONTRACTS.router} />
          <ContractRow name="AverisHood"         address={CONTRACTS.hood} />
          <ContractRow name="AverisPoolFactory"  address={CONTRACTS.factory} />
          <ContractRow name="AverisAdapterRegistry" address={CONTRACTS.registry} />
          <ContractRow name="AverisCredit"       address={CONTRACTS.credit} />
          <ContractRow name="AverisReserve"      address={CONTRACTS.reserve} />
          <ContractRow name="AverisACPAdapter"   address={CONTRACTS.acpAdapter} />
          <ContractRow name="ExternalJobAdapter" address={CONTRACTS.externalAdapter} />
        </div>
      </div>
    </div>
  )
}
