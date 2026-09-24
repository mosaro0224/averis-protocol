interface Props { size?: number; showText?: boolean }

export function AverisLogo({ size = 28, showText = true }: Props) {
  return (
    <div className="flex items-center gap-2">
      <svg
        width={size}
        height={Math.round(size * 0.88)}
        viewBox="0 0 100 88"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Left stroke: lavender/white top-right → strong blue bottom-left */}
          <linearGradient id="av-lg" x1="72" y1="4" x2="12" y2="84" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#eef0ff"/>
            <stop offset="40%"  stopColor="#8899ff"/>
            <stop offset="100%" stopColor="#3344ee"/>
          </linearGradient>
          {/* Right stroke: deep blue top → medium blue bottom */}
          <linearGradient id="av-rg" x1="78" y1="28" x2="92" y2="84" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#2233dd"/>
            <stop offset="100%" stopColor="#7788ff"/>
          </linearGradient>
        </defs>

        {/* Left stroke — wide diagonal band, bottom-left to upper-right, rounded ends */}
        <path d="
          M 6 84
          Q 2 84 4 80
          L 56 6
          Q 58 2 62 4
          L 74 6
          Q 78 8 76 12
          L 24 86
          Q 22 88 18 88
          Z
        " fill="url(#av-lg)" />

        {/* Right stroke — thinner diagonal, rounded notch at inner top */}
        <path d="
          M 62 32
          Q 66 26 70 30
          L 98 82
          Q 100 86 96 88
          L 84 88
          Q 80 88 78 84
          L 56 46
          Z
        " fill="url(#av-rg)" />
      </svg>

      {showText && (
        <span className="font-display font-semibold text-averis-text tracking-tight text-[15px]">
          AVERIS
        </span>
      )}
    </div>
  )
}
