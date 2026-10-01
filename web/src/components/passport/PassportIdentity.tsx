import { useCallback } from 'react'
import { usePassportIdentity } from '../../hooks/usePassport'
import { ERC8004_TESTNET } from '../../lib/passportConstants'
import { MintIdentity } from './MintIdentity'

interface Props { address: string }

export function PassportIdentity({ address }: Props) {
  const { data, status, reload } = usePassportIdentity(address)

  const handleMintSuccess = useCallback(() => {
    reload?.()
  }, [reload])

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">ERC-8004 IDENTITY</h2>

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading identity...</p>}
      {status === 'error'   && <p className="font-mono text-[11px] text-red-400">Failed to load identity.</p>}

      {status === 'ok' && (
        <>
          {/* Primary identity — registered */}
          {data?.primaryIdentity ? (
            <div className="bg-averis-card border border-averis-line rounded p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-averis-text">{data.primaryIdentity.chainName}</span>
                {data.primaryIdentity.verified && (
                  <span className="font-mono text-[9px] text-emerald-400 border border-emerald-400/40 rounded px-2 py-0.5">VERIFIED</span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Row label="Agent ID"  value={String(data.primaryIdentity.tokenId ?? data.primaryIdentity.agentId ?? 'N/A')} />
                <Row label="Wallet"    value={data.primaryIdentity.wallet} mono />
                <Row label="Chain"     value={data.primaryIdentity.caip2} />
                <Row label="Registry" value={data.primaryIdentity.registryAddress} mono />
                {data.primaryIdentity.metadataURI && (
                  <div className="space-y-0.5">
                    <p className="font-mono text-[9px] text-averis-muted uppercase">Metadata URI</p>
                    <a href={data.primaryIdentity.metadataURI} target="_blank" rel="noopener noreferrer"
                       className="font-mono text-[10px] text-blue-400 hover:text-blue-300 break-all">
                      {data.primaryIdentity.metadataURI}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* No identity — show mint form */
            <MintIdentity address={address} onSuccess={handleMintSuccess} />
          )}

          {/* All identities across chains */}
          {(data?.identities?.length ?? 0) > 0 && (
            <div className="space-y-3">
              <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase">
                Identities across chains ({data.identities.length})
              </h3>
              {data.identities.map((id: any, i: number) => (
                <div key={i} className="bg-averis-card border border-averis-line rounded p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-averis-text">{id.chainName}</span>
                    <span className={`font-mono text-[9px] ${id.verified ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {id.verified ? 'VERIFIED' : 'UNVERIFIED'}
                    </span>
                  </div>
                  <Row label="Agent ID" value={String(id.tokenId ?? id.agentId ?? 'N/A')} />
                  {(id.tokenIds?.length ?? 0) > 1 && (
                    <Row label="All Token IDs" value={(id.tokenIds ?? []).join(', ')} />
                  )}
                  <Row label="Chain"    value={id.caip2} />
                </div>
              ))}
            </div>
          )}

          {/* Register on additional chain if only one is registered */}
          {data?.primaryIdentity && (
            <details className="border border-averis-line/40 rounded">
              <summary className="font-mono text-[9px] tracking-widest text-averis-muted uppercase px-4 py-3 cursor-pointer hover:text-averis-text2 transition-colors">
                Register on another chain
              </summary>
              <div className="p-4 border-t border-averis-line/40">
                <MintIdentity address={address} onSuccess={handleMintSuccess} />
              </div>
            </details>
          )}

          {/* Registry reference */}
          <div className="border border-averis-line/40 rounded p-4 space-y-3">
            <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase">Canonical ERC-8004 Registries (Testnet)</h3>
            <Row label="Identity Registry"   value={ERC8004_TESTNET.identityRegistry} mono />
            <Row label="Reputation Registry" value={ERC8004_TESTNET.reputationRegistry} mono />
            <Row label="Validation Registry" value={ERC8004_TESTNET.validationRegistry} mono />
            <p className="font-mono text-[9px] text-averis-muted/60">
              CREATE2-deterministic. Same addresses on Arc Testnet (5042002) and Robinhood Chain Testnet (46630).
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[9px] text-averis-muted uppercase">{label}</p>
      <p className={`font-mono text-[10px] text-averis-text break-all ${mono ? 'text-[9px]' : ''}`}>{value}</p>
    </div>
  )
}
