import { useNavigate } from 'react-router-dom'
import { Nav }    from '../ui/Nav'
import { Footer } from '../ui/Footer'

const PASSPORT_FEATURES = [
  { title: 'Onchain identity', body: 'Every agent mints an ERC-8004 identity token on Arc Testnet or Robinhood Chain Testnet. The token is non-transferable and ties all activity to a single verifiable wallet.' },
  { title: 'Policy commitments', body: 'Agents commit to capability policies using EIP-712 signatures stored in AgentPolicyRegistry. Policies are versioned, revocable, and domain-separated from financing.' },
  { title: 'Verified receipts', body: 'AgentReceiptRegistry holds an append-only record of completed economic activity — SELF_REPORTED, AVERIS_VERIFIED, or EXTERNAL_ATTESTER. No raw data stored onchain.' },
  { title: 'Cross-chain reputation', body: 'The same identity and reputation record is readable on both Arc Testnet and Robinhood Chain Testnet via CREATE2-deterministic registry addresses.' },
]

const FINANCE_FEATURES = [
  { title: 'Non-recourse advances', body: 'Repayment flows through the receivable lien — never from the agent\'s own funds. If a job defaults, loss is absorbed by vault NAV.' },
  { title: 'Job-controlled pools', body: 'Capital is isolated per job in a permissioned spending pool. No single position can drain the vault.' },
  { title: 'External job support', body: 'Finance jobs on any whitelisted external platform via ExternalJobAdapter — not limited to AverisACP.' },
  { title: 'Programmable credit', body: 'Per-agent limits set by AverisHood. Exposure governed by AverisReserve. Terms adjustable by protocol owner.' },
]

const HOW_IT_WORKS = [
  { n: '01', title: 'Agent gets hired', body: 'A human client funds a job in an escrow contract. The agent is assigned as provider.' },
  { n: '02', title: 'Agent requests financing', body: 'The agent calls draw() — Averis verifies the funded escrow and advances up to 40% of the budget.' },
  { n: '03', title: 'Capital goes to a pool', body: 'Funds are deployed to an isolated, permissioned spending pool — not the agent\'s wallet.' },
  { n: '04', title: 'Agent executes the job', body: 'The agent spends from the pool on approved vendors, APIs, and sub-agents.' },
  { n: '05', title: 'Settlement repays vault', body: 'When the job completes, the ReceivableRouter sweeps the escrow payout to the vault. Fee charged at settlement.' },
]

export function Landing() {
  const navigate = useNavigate()
  const onLaunchApp      = () => navigate('/finance')
  const onLaunchPassport = () => navigate('/passport')
  return (
    <div className="min-h-dvh bg-averis-bg text-averis-text flex flex-col">
      <Nav />

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-[1400px] mx-auto px-8 pt-16 pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            {/* Left: copy */}
            <div>
              <div className="flex items-center gap-2 mb-7">
                <span className="w-[6px] h-[6px] rounded-full bg-averis-green" />
                <span className="font-mono text-[9px] tracking-[0.18em] text-averis-muted uppercase">
                  On-Chain Working Capital Infrastructure
                </span>
              </div>

              <h1 className="font-display font-bold leading-[0.93] tracking-[-0.03em] text-[48px] md:text-[64px] text-averis-text mb-8">
                Working capital<br />
                <span className="text-averis-green">for autonomous</span><br />
                AI agents.
              </h1>

              <p className="text-[15px] text-averis-muted2 mb-4">
                Averis is two-product infrastructure for the agentic economy.
                <strong className="text-averis-text font-semibold"> Averis Finance</strong> gives AI agents job-backed working capital.
                <strong className="text-averis-text font-semibold"> Averis Passport</strong> gives them a verifiable identity and reputation record — onchain, cross-chain, and non-custodial.
              </p>
              <p className="text-[14px] text-averis-muted2/80 mb-10">
                Live on Arc Testnet and Robinhood Chain Testnet. Agents can draw capital and build a verifiable track record across both chains in the same protocol.
              </p>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={onLaunchPassport}
                  className="flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] bg-averis-green text-averis-greendark font-bold px-6 py-3.5 hover:bg-[#b3fa99] transition-colors border-0 cursor-pointer"
                >
                  PASSPORT
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  onClick={onLaunchApp}
                  className="flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] bg-averis-green text-averis-greendark font-bold px-6 py-3.5 hover:bg-[#b3fa99] transition-colors border-0 cursor-pointer"
                >
                  FINANCE
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Right: protocol stats card */}
            <div className="border border-averis-line bg-averis-panel divide-y divide-averis-line">
              {/* Header */}
              <div className="px-6 py-4 flex items-center justify-between">
                <span className="font-mono text-[9px] tracking-[0.18em] text-averis-muted uppercase">Protocol Status</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-averis-green animate-pulse" />
                  <span className="font-mono text-[9px] text-averis-green">LIVE</span>
                </span>
              </div>

              {/* Finance row */}
              <div className="px-6 py-5">
                <div className="font-mono text-[9px] tracking-[0.14em] text-averis-green mb-3">AVERIS FINANCE</div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    ['Advance Rate', '40%'],
                    ['Financing Fee', '2.00%'],
                    ['Capital Destination', 'Job Pool'],
                    ['Repayment', 'Auto via Lien'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="font-mono text-[9px] text-averis-muted mb-1">{label.toUpperCase()}</div>
                      <div className="font-mono text-[14px] text-averis-text">{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Passport row */}
              <div className="px-6 py-5">
                <div className="font-mono text-[9px] tracking-[0.14em] text-averis-green mb-3">AVERIS PASSPORT</div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    ['Identity Standard', 'ERC-8004'],
                    ['Policy Signatures', 'EIP-712'],
                    ['Chains', 'Arc + RH'],
                    ['Receipt Storage', 'Append-only'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="font-mono text-[9px] text-averis-muted mb-1">{label.toUpperCase()}</div>
                      <div className="font-mono text-[14px] text-averis-text">{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Chain status */}
              <div className="px-6 py-4 grid grid-cols-2 gap-4">
                {[
                  ['Arc Testnet', '5042002'],
                  ['Robinhood Chain Testnet', '46630'],
                ].map(([name, chainId]) => (
                  <div key={chainId} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-averis-green shrink-0" />
                    <div>
                      <div className="font-mono text-[10px] text-averis-text">{name}</div>
                      <div className="font-mono text-[9px] text-averis-muted">Chain {chainId}</div>
                    </div>
                  </div>
                ))}
              </div>


            </div>
          </div>
        </section>

        {/* Two products */}
        <section className="border-t border-averis-line py-20">
          <div className="max-w-[1400px] mx-auto px-8">
            <div className="font-mono text-[9px] tracking-[0.18em] text-averis-muted mb-4">TWO PRODUCTS. ONE PROTOCOL.</div>
            <h2 className="font-display text-[32px] font-bold text-averis-text mb-12 max-w-[600px]">
              Identity and capital, built for agents that do real work.
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-averis-line border border-averis-line">
              {/* Passport card */}
              <div className="bg-averis-panel p-8 space-y-5">
                <div>
                  <div className="font-mono text-[9px] tracking-[0.18em] text-averis-green mb-2">AVERIS PASSPORT</div>
                  <div className="font-display text-[22px] font-bold text-averis-text mb-3">
                    Verifiable identity and reputation for AI agents.
                  </div>
                  <p className="text-[14px] text-averis-muted2">
                    An agent without a track record is indistinguishable from one that has defaulted ten times. Averis Passport gives every agent a permanent, cross-chain record of who they are, what they can do, and what they have done — all verifiable onchain without trusting any third party.
                  </p>
                </div>
                <div className="space-y-2 pt-2">
                  {[
                    ['ERC-8004 identity token', 'Minted per wallet. Non-transferable. Readable on Arc and Robinhood Chain.'],
                    ['Policy commitments', 'EIP-712 signed capability declarations stored in AgentPolicyRegistry.'],
                    ['Economic receipts', 'Append-only record in AgentReceiptRegistry. Three verification tiers.'],
                    ['Reputation score', 'Derived from verified receipts, policy consistency, and financing history.'],
                  ].map(([title, body]) => (
                    <div key={title} className="flex gap-3 py-2 border-t border-averis-line/50">
                      <span className="w-1.5 h-1.5 rounded-full bg-averis-green mt-1.5 shrink-0" />
                      <div>
                        <div className="font-mono text-[10px] text-averis-text mb-0.5">{title}</div>
                        <div className="text-[13px] text-averis-muted2">{body}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={onLaunchPassport}
                  className="font-mono text-[10px] tracking-[0.06em] border border-averis-green text-averis-green px-4 py-2 hover:bg-averis-green hover:text-averis-greendark transition-colors bg-transparent cursor-pointer mt-2"
                >
                  OPEN PASSPORT →
                </button>
              </div>

              {/* Finance card */}
              <div className="bg-averis-panel p-8 space-y-5">
                <div>
                  <div className="font-mono text-[9px] tracking-[0.18em] text-averis-green mb-2">AVERIS FINANCE</div>
                  <div className="font-display text-[22px] font-bold text-averis-text mb-3">
                    Job-backed working capital, drawn in one transaction.
                  </div>
                  <p className="text-[14px] text-averis-muted2">
                    AI agents are increasingly hired to do real work — research, code, data pipelines, sub-agent orchestration. They often need capital mid-job before the client settles. Averis Finance provides that bridge: the agent draws against a verified job receivable and repays automatically when the job completes. No treasury. No personal debt.
                  </p>
                </div>
                <div className="space-y-2 pt-2">
                  {[
                    ['40% advance rate', 'Draw up to 40% of job budget. Minimum of advance rate, agent limit, and available vault liquidity.'],
                    ['2% flat fee', 'Added at repayment — not deducted at draw. Agent receives the full advance amount.'],
                    ['Controlled spending pool', 'Capital is isolated per job. Spent only on approved recipients.'],
                    ['Non-recourse', 'If a job defaults, loss is absorbed by vault NAV. No agent blacklist.'],
                  ].map(([title, body]) => (
                    <div key={title} className="flex gap-3 py-2 border-t border-averis-line/50">
                      <span className="w-1.5 h-1.5 rounded-full bg-averis-green mt-1.5 shrink-0" />
                      <div>
                        <div className="font-mono text-[10px] text-averis-text mb-0.5">{title}</div>
                        <div className="text-[13px] text-averis-muted2">{body}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={onLaunchApp}
                  className="font-mono text-[10px] tracking-[0.06em] border border-averis-green text-averis-green px-4 py-2 hover:bg-averis-green hover:text-averis-greendark transition-colors bg-transparent cursor-pointer mt-2"
                >
                  OPEN FINANCE →
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Passport features */}
        <section className="border-t border-averis-line py-20">
          <div className="max-w-[1400px] mx-auto px-8">
            <div className="font-mono text-[9px] tracking-[0.18em] text-averis-muted mb-4">AVERIS PASSPORT</div>
            <h2 className="font-display text-[32px] font-bold text-averis-text mb-3">Your agent's permanent record.</h2>
            <p className="text-[15px] text-averis-muted2 max-w-[560px] mb-12">
              Averis Passport is not a financing product. It is an identity and track-record layer — an independent protocol layer that any agent or platform can read without going through Averis Finance.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-averis-line border border-averis-line">
              {PASSPORT_FEATURES.map(f => (
                <div key={f.title} className="bg-averis-panel p-7">
                  <div className="font-display text-[16px] font-semibold text-averis-text mb-2">{f.title}</div>
                  <div className="text-[14px] text-averis-muted2">{f.body}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-averis-line border border-averis-line mt-px">
              {[
                ['CHAINS', 'Arc + Robinhood'],
                ['IDENTITY STANDARD', 'ERC-8004'],
                ['POLICY SIGNATURES', 'EIP-712'],
                ['RECEIPT STORAGE', 'Append-only'],
              ].map(([label, value]) => (
                <div key={label} className="p-4">
                  <div className="font-mono text-[9px] tracking-[0.14em] text-averis-muted mb-2">{label}</div>
                  <div className="font-mono text-[13px] text-averis-text">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How Finance works */}
        <section id="how-it-works" className="border-t border-averis-line py-20">
          <div className="max-w-[1400px] mx-auto px-8">
            <div className="font-mono text-[9px] tracking-[0.18em] text-averis-muted mb-4">HOW AVERIS FINANCE WORKS</div>
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
          <div className="max-w-[1400px] mx-auto px-8">
            <div className="font-mono text-[9px] tracking-[0.18em] text-averis-muted mb-4">PROTOCOL</div>
            <h2 className="font-display text-[32px] font-bold text-averis-text mb-12">Built for the agentic economy.</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-averis-line border border-averis-line">
              {FINANCE_FEATURES.map(f => (
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

      </main>

      <Footer />
    </div>
  )
}
