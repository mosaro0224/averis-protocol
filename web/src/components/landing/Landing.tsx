import { Nav }    from '../ui/Nav'
import { Footer } from '../ui/Footer'

const HOW_IT_WORKS = [
  { n: '01', title: 'Agent gets hired', body: 'A human client funds a job in an escrow contract. The agent (your AI) is assigned as provider.' },
  { n: '02', title: 'Agent requests financing', body: 'The agent calls draw() — Averis verifies the funded escrow and advances up to 40% of the budget.' },
  { n: '03', title: 'Capital goes to a pool', body: 'Funds are deployed to an isolated, permissioned spending pool — not the agent\'s wallet.' },
  { n: '04', title: 'Agent executes the job', body: 'The agent spends from the pool on approved vendors, APIs, and sub-agents.' },
  { n: '05', title: 'Settlement repays vault', body: 'When the job completes, the ReceivableRouter sweeps the escrow payout to the vault. Fee charged at settlement.' },
]

const PROTOCOL_FEATURES = [
  { title: 'Non-recourse advances', body: 'Repayment flows through the receivable lien — never from the agent\'s own funds.' },
  { title: 'Job-controlled pools', body: 'Capital is isolated per job. No single position can drain the vault.' },
  { title: 'External job support', body: 'Finance jobs on any whitelisted external platform via ExternalJobAdapter.' },
  { title: 'Programmable credit', body: 'Per-agent limits set by AverisHood. Exposure governed by AverisReserve.' },
]

interface Props {
  onLaunchApp: () => void
}

export function Landing({ onLaunchApp }: Props) {
  return (
    <div className="min-h-dvh bg-averis-bg text-averis-text flex flex-col">
      <Nav onLaunchApp={onLaunchApp} />

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-[1180px] mx-auto px-6 pt-16 pb-24">
          <div className="flex items-center gap-2 mb-7">
            <span className="w-[6px] h-[6px] rounded-full bg-averis-green" />
            <span className="font-mono text-[9px] tracking-[0.18em] text-averis-muted uppercase">
              On-Chain Working Capital Infrastructure
            </span>
          </div>

          <h1 className="font-display font-bold leading-[0.93] tracking-[-0.03em] text-[48px] md:text-[64px] text-averis-text max-w-[700px] mb-8">
            Working capital<br />
            <span className="text-averis-green">for autonomous</span><br />
            AI agents.
          </h1>

          <p className="text-[15px] text-averis-muted2 max-w-[420px] mb-10">
            Averis gives AI agents temporary access to capital so they can finish the jobs they have already been hired to complete.
            Credit backed by verified on-chain receivables.
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={onLaunchApp}
              className="flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] bg-averis-green text-averis-greendark font-bold px-6 py-3.5 hover:bg-[#b3fa99] transition-colors border-0 cursor-pointer"
            >
              LAUNCH APP
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] border border-averis-line text-averis-text2 px-6 py-3.5 no-underline hover:border-averis-linemid transition-colors bg-transparent cursor-pointer"
            >
              HOW IT WORKS
            </button>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-t border-averis-line py-20">
          <div className="max-w-[1180px] mx-auto px-6">
            <div className="font-mono text-[9px] tracking-[0.18em] text-averis-muted mb-4">HOW IT WORKS</div>
            <h2 className="font-display text-[32px] font-bold text-averis-text mb-12">From hired to funded in one call.</h2>
            <div className="space-y-0">
              {HOW_IT_WORKS.map((item, i) => (
                <div key={item.n} className={`flex items-start gap-6 py-6 ${i > 0 ? 'border-t border-averis-line' : ''}`}>
                  <span className="font-mono text-[9px] text-averis-muted2 w-8 shrink-0 mt-1">{item.n}</span>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_80px_1fr] gap-4 w-full">
                    <div className="font-display text-[18px] font-semibold text-averis-text">{item.title}</div>
                    <div />
                    <div className="text-[14px] text-averis-muted2 md:max-w-[400px]">{item.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Protocol */}
        <section id="protocol" className="border-t border-averis-line py-20">
          <div className="max-w-[1180px] mx-auto px-6">
            <div className="font-mono text-[9px] tracking-[0.18em] text-averis-muted mb-4">PROTOCOL</div>
            <h2 className="font-display text-[32px] font-bold text-averis-text mb-12">Built for the agentic economy.</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-averis-line border border-averis-line">
              {PROTOCOL_FEATURES.map(f => (
                <div key={f.title} className="bg-averis-panel p-7">
                  <div className="font-display text-[16px] font-semibold text-averis-text mb-2">{f.title}</div>
                  <div className="text-[14px] text-averis-muted2">{f.body}</div>
                </div>
              ))}
            </div>

            {/* Protocol parameters */}
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-averis-line border border-averis-line mt-px">
              {[
                ['ADVANCE RATE', '40%'],
                ['FINANCING FEE', '2.00%'],
                ['CAPITAL DESTINATION', 'Job Spending Pool'],
                ['REPAYMENT', 'Via Receivable Lien'],
              ].map(([label, value]) => (
                <div key={label} className="p-4">
                  <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-2">{label}</div>
                  <div className="font-mono text-[13px] text-averis-text">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-averis-line py-12">
          <div className="max-w-[1180px] mx-auto px-6">
            <div className="border border-averis-line bg-averis-panel p-10 md:p-14 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
              <div>
                <div className="font-mono text-[9px] tracking-[0.18em] text-averis-muted mb-3">START BUILDING</div>
                <h3 className="font-display text-[28px] md:text-[36px] font-bold text-averis-text mb-3">
                  Launch the Averis app.
                </h3>
                <p className="text-[14px] text-averis-muted2 max-w-[420px]">
                  Connect a wallet on Arc Testnet, supply USDC to the vault as an LP, or present an active job to access working capital as an agent.
                </p>
              </div>
              <button
                onClick={onLaunchApp}
                className="flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] bg-averis-green text-averis-greendark font-bold px-8 py-4 hover:bg-[#b3fa99] transition-colors border-0 cursor-pointer shrink-0 whitespace-nowrap"
              >
                LAUNCH APP
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
