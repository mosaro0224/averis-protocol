/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'averis-bg':       '#070908',
        'averis-bg2':      '#0c0f0c',
        'averis-panel':    '#0f120f',
        'averis-surface':  '#131613',
        'averis-surface2': '#181c18',
        'averis-line':     '#1e221e',
        'averis-linemid':  '#252925',
        'averis-text':     '#edf0e9',
        'averis-text2':    '#c8cdc4',
        'averis-muted':    '#6e7669',
        'averis-muted2':   '#4a4f47',
        'averis-green':    '#9cf57d',
        'averis-greendark':'#0d1e0a',
        'averis-amber':    '#f5cd7d',
        'averis-red':      '#e8756d',
      },
      fontFamily: {
        sans:    ['DM Sans', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
