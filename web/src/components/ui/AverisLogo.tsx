interface Props { size?: number; showText?: boolean }

export function AverisLogo({ size = 28, showText = true }: Props) {
  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 160 160" fill="none">
        <polygon points="80,8 152,46 152,114 80,152 8,114 8,46" fill="#0d1e0a" stroke="#9cf57d" strokeWidth="6"/>
        <polygon points="28,88 46,44 54,44 40,88" fill="#09100c"/>
        <polygon points="80,28 108,88 100,88 80,44 60,88 52,88" fill="#9cf57d"/>
        <polygon points="72,72 88,72 84,88 76,88" fill="#9cf57d"/>
        <polygon points="92,44 132,44 120,88 112,88 121,52 92,52" fill="#edf0e9"/>
      </svg>
      {showText && (
        <span className="font-display font-semibold text-averis-text tracking-tight text-[15px]">
          AVERIS
        </span>
      )}
    </div>
  )
}
