interface Props { size?: number; showText?: boolean }

export function AverisLogo({ size = 28, showText = true }: Props) {
  const h = Math.round(size * 665 / 1024)
  return (
    <div className="flex items-center gap-2">
      <svg
        width={size}
        height={h}
        viewBox="0 0 1024 665"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="av-lg" x1="170" y1="620" x2="720" y2="45" gradientUnits="userSpaceOnUse">
            <stop offset="0"    stopColor="#245BFF"/>
            <stop offset="0.48" stopColor="#5D87FF"/>
            <stop offset="1"    stopColor="#F7F9FF"/>
          </linearGradient>
          <linearGradient id="av-rg" x1="620" y1="330" x2="930" y2="650" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1449F5"/>
            <stop offset="1" stopColor="#7B9EFF"/>
          </linearGradient>
        </defs>
        {/* Main rising mark */}
        <path fill="url(#av-lg)" d="M 0 665 L 206 665 C 253 665 293 643 324 607 L 807 7 L 652 7 L 154 526 C 142 538 128 550 114 562 L 0 665 Z"/>
        {/* Secondary descending mark */}
        <path fill="url(#av-rg)" d="M 712 244 L 1024 665 L 747 665 L 591 407 C 584 395 586 382 596 372 L 704 257 C 707 253 710 248 712 244 Z"/>
      </svg>
      {showText && (
        <span className="font-display font-semibold text-averis-text tracking-tight text-[15px]">
          AVERIS
        </span>
      )}
    </div>
  )
}
