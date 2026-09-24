import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { AppNav, AppTab } from './AppNav'
import { Overview }  from './Overview'
import { Agents }    from './Agents'
import { Financing } from './Financing'
import { Pools }     from './Pools'
import { Vault }     from './Vault'
import { Security }  from './Security'
import { Activity }  from './Activity'
import { AverisLogo } from '../ui/AverisLogo'
import { EXPLORER }  from '../../lib/constants'

const LS_TAB = '_av_tab'

interface Props { onBack: () => void }

export function App({ onBack }: Props) {
  const { address } = useAccount()
  const [tab, setTab] = useState<AppTab>(() => (localStorage.getItem(LS_TAB) as AppTab) ?? 'overview')

  useEffect(() => { localStorage.setItem(LS_TAB, tab) }, [tab])

  return (
    <div className="min-h-dvh bg-averis-bg text-averis-text flex flex-col">
      {/* Inner nav bar */}
      <div className="border-b border-averis-line sticky top-0 bg-[#09100c] z-40">
        <div className="max-w-[1180px] mx-auto px-6 h-12 flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-1.5 bg-transparent border-0 cursor-pointer text-averis-muted hover:text-averis-text transition-colors p-0">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <AverisLogo size={20} />
            <span className="font-mono text-[10px] text-averis-muted">/</span>
            <span className="font-mono text-[11px] tracking-[0.06em] text-averis-text2">APP</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {address && (
              <a
                href={`${EXPLORER}/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[9px] text-averis-muted hover:text-averis-text no-underline transition-colors"
              >
                {address.slice(0, 6)}…{address.slice(-4)}
              </a>
            )}
            <appkit-button size="sm" />
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <AppNav active={tab} onChange={setTab} />

      {/* Tab content */}
      <div className="flex-1">
        {tab === 'overview'   && <Overview />}
        {tab === 'agents'     && <Agents />}
        {tab === 'financing'  && <Financing />}
        {tab === 'pools'      && <Pools />}
        {tab === 'vault'      && <Vault />}
        {tab === 'security'   && <Security />}
        {tab === 'activity'   && <Activity />}
      </div>
    </div>
  )
}
