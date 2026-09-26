import { AverisLogo } from './AverisLogo'

interface Props {
  onLaunchApp: () => void
}

export function Nav({ onLaunchApp }: Props) {
  return (
    <nav className="border-b border-averis-line sticky top-0 bg-[#09100c] z-40">
      <div className="max-w-[1180px] mx-auto px-6 h-14 flex items-center gap-4">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center gap-0 border-0 bg-transparent cursor-pointer flex-shrink-0 whitespace-nowrap p-0"
        >
          <AverisLogo size={28} />
        </button>

        <div className="ml-4 hidden md:flex items-center gap-1">
          <button onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
            className="font-mono text-[10px] tracking-[0.06em] text-averis-muted2 hover:text-averis-text px-3 py-2 bg-transparent border-0 cursor-pointer transition-colors">
            HOW IT WORKS
          </button>
          <button onClick={() => document.getElementById('protocol')?.scrollIntoView({ behavior: 'smooth' })}
            className="font-mono text-[10px] tracking-[0.06em] text-averis-muted2 hover:text-averis-text px-3 py-2 bg-transparent border-0 cursor-pointer transition-colors">
            PROTOCOL
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={onLaunchApp}
            className="font-mono text-[10px] tracking-[0.06em] text-averis-text2 border border-averis-line px-4 py-2 bg-transparent hover:border-averis-linemid transition-colors cursor-pointer"
          >
            LAUNCH APP
          </button>
          <appkit-button />
        </div>
      </div>
    </nav>
  )
}
