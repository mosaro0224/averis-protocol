import { AverisLogo } from './AverisLogo'

export function Footer() {
  return (
    <footer className="border-t border-averis-line mt-0 bg-[#09100c]">
      <div className="max-w-[1400px] mx-auto px-8 py-4 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <AverisLogo size={18} showText={false} />
          <span className="font-mono text-[9px] text-averis-muted tracking-[0.1em]">AVERIS</span>
          <span className="text-averis-muted2">·</span>
          <span className="font-mono text-[9px] text-averis-muted tracking-[0.1em]">ARC TESTNET</span>
          <span className="text-averis-muted2">·</span>
          <span className="font-mono text-[9px] text-averis-muted tracking-[0.1em]">TESTNET ONLY — NOT AUDITED</span>
          <span className="text-averis-muted2">·</span>
          <span className="font-mono text-[9px] text-averis-green tracking-[0.1em]">JOB-CONTROLLED SPENDING POOLS ACTIVE</span>
        </div>
        <a
          href="https://x.com/averis_protocol"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 font-mono text-[9px] text-averis-muted hover:text-averis-text no-underline transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          @averis_protocol
        </a>
      </div>
    </footer>
  )
}
