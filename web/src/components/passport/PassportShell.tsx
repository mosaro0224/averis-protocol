import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { PassportNav, type PassportTab } from './PassportNav'
import { PassportOverview }      from './PassportOverview'
import { PassportIdentity }      from './PassportIdentity'
import { PassportCapabilities }  from './PassportCapabilities'
import { PassportAuthorization } from './PassportAuthorization'
import { PassportReputation }    from './PassportReputation'
import { PassportRisk }          from './PassportRisk'
import { PassportAgreements }    from './PassportAgreements'
import { PassportTransactions }  from './PassportTransactions'
import { PassportCounterparties } from './PassportCounterparties'
import { PassportReceipts }      from './PassportReceipts'
import { AverisLogo } from '../ui/AverisLogo'

const LS_PASSPORT_TAB = '_av_passport_tab'

interface Props {
  onBack: () => void
}

export function PassportShell({ onBack }: Props) {
  const { address } = useAccount()
  const [tab, setTab] = useState<PassportTab>(
    () => (localStorage.getItem(LS_PASSPORT_TAB) as PassportTab) ?? 'overview'
  )
  const [lookupAddress, setLookupAddress] = useState<string>('')
  const [resolvedAddress, setResolvedAddress] = useState<string>('')

  useEffect(() => { localStorage.setItem(LS_PASSPORT_TAB, tab) }, [tab])

  // Use connected wallet by default; allow manual lookup
  const activeAddress = resolvedAddress || address || ''

  const handleLookup = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (/^0x[0-9a-fA-F]{40}$/.test(lookupAddress)) {
      setResolvedAddress(lookupAddress)
    }
  }

  return (
    <div className="min-h-dvh bg-averis-bg text-averis-text flex flex-col">
      {/* Nav bar */}
      <div className="border-b border-averis-line sticky top-0 bg-[#09100c] z-40">
        <div className="w-full px-8 h-12 flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 bg-transparent border-0 cursor-pointer text-averis-muted hover:text-averis-text transition-colors p-0"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <AverisLogo size={20} />
            <span className="font-mono text-[10px] text-averis-muted">/</span>
            <span className="font-mono text-[11px] tracking-[0.06em] text-averis-text2">PASSPORT</span>
          </div>

          {/* Address lookup */}
          <form onSubmit={handleLookup} className="hidden md:flex items-center gap-2 ml-4">
            <input
              type="text"
              value={lookupAddress}
              onChange={e => setLookupAddress(e.target.value)}
              placeholder="0x... lookup any address"
              className="font-mono text-[10px] bg-[#1a1a1a] border border-[#444] rounded px-2 py-1 w-60 text-white placeholder:text-[#666] focus:outline-none focus:border-blue-400"
            />
            <button
              type="submit"
              className="font-mono text-[9px] text-blue-400 border border-blue-400/30 rounded px-2 py-1 bg-transparent cursor-pointer hover:bg-blue-400/10"
            >
              LOOKUP
            </button>
            {resolvedAddress && resolvedAddress !== address && (
              <button
                type="button"
                onClick={() => { setResolvedAddress(''); setLookupAddress('') }}
                className="font-mono text-[9px] text-averis-muted hover:text-averis-text border border-averis-line rounded px-2 py-1 bg-transparent cursor-pointer"
              >
                CLEAR
              </button>
            )}
          </form>

          <div className="ml-auto">
            <appkit-button size="sm" />
          </div>
        </div>
      </div>

      {/* Address banner */}
      {!activeAddress && (
        <div className="px-8 py-3 bg-averis-card border-b border-averis-line">
          <p className="font-mono text-[10px] text-averis-muted">Connect your wallet or enter an address above to view a passport.</p>
        </div>
      )}
      {resolvedAddress && resolvedAddress !== address && (
        <div className="px-8 py-2 bg-averis-card border-b border-averis-line">
          <p className="font-mono text-[9px] text-averis-muted">Viewing: <span className="text-averis-text">{resolvedAddress}</span></p>
        </div>
      )}

      {/* Tabs */}
      <PassportNav active={tab} onChange={setTab} />

      {/* Content */}
      {activeAddress ? (
        <div className="flex-1 w-full">
          {tab === 'overview'       && <PassportOverview      address={activeAddress} onNav={setTab} />}
          {tab === 'identity'       && <PassportIdentity      address={activeAddress} />}
          {tab === 'capabilities'   && <PassportCapabilities  address={activeAddress} />}
          {tab === 'authorization'  && <PassportAuthorization address={activeAddress} />}
          {tab === 'reputation'     && <PassportReputation    address={activeAddress} />}
          {tab === 'risk'           && <PassportRisk          address={activeAddress} />}
          {tab === 'agreements'     && <PassportAgreements    address={activeAddress} />}
          {tab === 'transactions'   && <PassportTransactions  address={activeAddress} />}
          {tab === 'counterparties' && <PassportCounterparties address={activeAddress} />}
          {tab === 'receipts'       && <PassportReceipts      address={activeAddress} />}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="font-mono text-[12px] text-averis-muted">Connect wallet to view your passport</p>
            <p className="font-mono text-[10px] text-averis-muted/60">or enter any address in the lookup bar above</p>
          </div>
        </div>
      )}
    </div>
  )
}
