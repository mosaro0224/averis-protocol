interface Props { size?: number; showText?: boolean }

export function AverisLogo({ size = 28, showText = true }: Props) {
  const id = `avg-${size}`
  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={`${id}-left`} x1="30%" y1="0%" x2="70%" y2="100%">
            <stop offset="0%"   stopColor="#d0e4ff" />
            <stop offset="50%"  stopColor="#6aaaf0" />
            <stop offset="100%" stopColor="#2060c8" />
          </linearGradient>
          <linearGradient id={`${id}-right`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#0040c8" />
            <stop offset="100%" stopColor="#1a60e8" />
          </linearGradient>
        </defs>
        {/* Left blade — tall diagonal parallelogram, light top to dark bottom */}
        <polygon points="22,92 40,8 58,8 38,92" fill={`url(#${id}-left)`} />
        {/* Right blade — solid deep blue triangle, lower right */}
        <polygon points="50,58 78,92 64,92" fill={`url(#${id}-right)`} />
      </svg>
      {showText && (
        <span className="font-display font-semibold text-averis-text tracking-tight text-[15px]">
          AVERIS
        </span>
      )}
    </div>
  )
}
