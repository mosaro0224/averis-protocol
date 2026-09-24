import { EXPLORER } from '../../lib/constants'

interface Props { name: string; address: string }

export function ContractRow({ name, address }: Props) {
  const short = address.slice(0, 6) + '…' + address.slice(-4)
  return (
    <div className="flex items-center justify-between border-b border-averis-line last:border-0 px-5 py-4">
      <span className="font-mono text-[11px] text-averis-text2">{name}</span>
      <a
        href={`${EXPLORER}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 font-mono text-[10px] text-averis-muted hover:text-averis-text no-underline transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M8 2H14V8M14 2L7 9M3 4H2V14H12V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        {short}
      </a>
    </div>
  )
}
