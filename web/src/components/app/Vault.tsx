import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, formatUnits, maxUint256 } from 'viem'
import { CONTRACTS, USDC_DECIMALS } from '../../lib/constants'
import { VAULT_ABI, ERC20_ABI } from '../../lib/abis'

type Mode = 'deposit' | 'withdraw'

export function Vault() {
  const { address } = useAccount()
  const [mode, setMode] = useState<Mode>('deposit')
  const [amount, setAmount] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()

  const { data: totalAssets }  = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'totalAssets' })
  const { data: available }    = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'availableLiquidity' })
  const { data: outstanding }  = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'outstandingPrincipal' })
  const { data: usdcBalance }  = useReadContract({ address: CONTRACTS.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: address ? [address] : undefined, query: { enabled: !!address } })
  const { data: vaultShares }  = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'balanceOf', args: address ? [address] : undefined, query: { enabled: !!address } })
  const { data: maxWithdraw }  = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'maxWithdraw', args: address ? [address] : undefined, query: { enabled: !!address } })
  const { data: allowance }    = useReadContract({ address: CONTRACTS.usdc, abi: ERC20_ABI, functionName: 'allowance', args: address ? [address, CONTRACTS.vault] : undefined, query: { enabled: !!address } })
  const { data: suppliedAmt }  = useReadContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'convertToAssets', args: vaultShares ? [vaultShares] : undefined, query: { enabled: !!vaultShares } })

  const { writeContract, isPending } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  const fmt = (v: bigint | undefined, dec = USDC_DECIMALS) =>
    v !== undefined ? parseFloat(formatUnits(v, dec)).toFixed(2) : '0.00'
  const fmtShares = (v: bigint | undefined) =>
    v !== undefined ? parseFloat(formatUnits(v, USDC_DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'

  const amountBig = amount ? parseUnits(amount, USDC_DECIMALS) : 0n
  const needsApproval = mode === 'deposit' && allowance !== undefined && allowance < amountBig

  function handleAction() {
    if (!address || !amount) return
    const parsed = parseUnits(amount, USDC_DECIMALS)
    if (mode === 'deposit') {
      if (needsApproval) {
        writeContract({ address: CONTRACTS.usdc, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.vault, maxUint256] },
          { onSuccess: (h) => setTxHash(h) })
      } else {
        writeContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'deposit', args: [parsed, address] },
          { onSuccess: (h) => setTxHash(h) })
      }
    } else {
      writeContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: 'withdraw', args: [parsed, address, address] },
        { onSuccess: (h) => setTxHash(h) })
    }
  }

  return (
    <div className="max-w-[1180px] mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-3">LIQUIDITY VAULT</div>
        <h2 className="font-display text-[28px] font-bold text-averis-text mb-2">Vault</h2>
        <p className="text-[14px] text-averis-muted2 max-w-[520px]">
          Supply USDC liquidity. Earn yield from financing fees. Capital is deployed only against verified job positions.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-averis-line border border-averis-line">
        {[
          ['TOTAL ASSETS', `$${fmt(totalAssets)}`],
          ['AVAILABLE', `$${fmt(available)}`],
          ['DEPLOYED', `$${fmt(outstanding)}`],
          ['YOUR DEPOSIT', `$${fmt(suppliedAmt)}`],
        ].map(([label, value]) => (
          <div key={label} className="p-4">
            <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-2">{label}</div>
            <div className="font-display text-[20px] font-semibold text-averis-text tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Deposit / Withdraw form */}
        <div className="border border-averis-line">
          {/* Mode toggle */}
          <div className="flex border-b border-averis-line">
            {(['deposit', 'withdraw'] as Mode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 font-mono text-[10px] tracking-[0.08em] py-3 border-b-2 transition-colors bg-transparent border-l-0 border-r-0 border-t-0 cursor-pointer uppercase
                  ${mode === m ? 'text-averis-green border-averis-green' : 'text-averis-muted border-transparent hover:text-averis-text'}`}>
                {m}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            {address ? (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-mono text-[9px] tracking-[0.14em] text-averis-muted">
                      {mode === 'deposit' ? 'AMOUNT (USDC)' : 'AMOUNT TO WITHDRAW (USDC)'}
                    </label>
                    <button onClick={() => setAmount(mode === 'deposit' ? fmt(usdcBalance) : fmt(maxWithdraw))}
                      className="font-mono text-[8px] text-averis-green bg-transparent border-0 cursor-pointer hover:opacity-80">
                      MAX
                    </button>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-averis-bg border border-averis-line focus:border-averis-linemid outline-none font-mono text-[13px] text-averis-text px-3 py-2.5 placeholder:text-averis-muted2"
                  />
                  <div className="font-mono text-[9px] text-averis-muted mt-1">
                    {mode === 'deposit' ? `Wallet: $${fmt(usdcBalance)} USDC` : `Max withdraw: $${fmt(maxWithdraw)}`}
                  </div>
                </div>

                <button
                  onClick={handleAction}
                  disabled={isPending || isConfirming || !amount}
                  className="w-full font-mono text-[11px] tracking-[0.06em] bg-averis-green text-averis-greendark font-bold py-3 border-0 hover:bg-[#b3fa99] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending || isConfirming
                    ? 'CONFIRMING…'
                    : needsApproval
                    ? 'APPROVE USDC'
                    : mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'}
                </button>

                {txHash && (
                  <div className="font-mono text-[9px] text-averis-muted break-all">
                    TX: {txHash}
                  </div>
                )}
              </>
            ) : (
              <div className="py-8 text-center">
                <p className="font-mono text-[10px] text-averis-muted">Connect wallet to deposit or withdraw</p>
              </div>
            )}
          </div>
        </div>

        {/* Your position */}
        <div className="border border-averis-line">
          <div className="border-b border-averis-line px-5 py-4">
            <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted">YOUR POSITION</div>
          </div>
          <div className="p-5 space-y-4">
            {[
              ['Vault shares', fmtShares(vaultShares)],
              ['USDC deposited', `$${fmt(suppliedAmt)}`],
              ['Wallet USDC', `$${fmt(usdcBalance)}`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-averis-muted">{label}</span>
                <span className="font-mono text-[12px] text-averis-text tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
