import { usePassportPolicies } from '../../hooks/usePassport'
import { PASSPORT_CONTRACTS, RH_TESTNET } from '../../lib/passportConstants'

interface Props { address: string }

function PolicyCard({ policy }: { policy: any }) {
  const now = Math.floor(Date.now() / 1000)
  const expired = policy.expiresAt > 0 && policy.expiresAt < now
  return (
    <div className={`bg-averis-card border rounded p-4 space-y-3 ${policy.revoked ? 'border-red-400/30' : expired ? 'border-amber-400/30' : 'border-averis-line'}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-averis-text">Policy #{policy.policyId} v{policy.version}</span>
        <span className={`font-mono text-[9px] ${policy.revoked ? 'text-red-400' : policy.active ? 'text-emerald-400' : 'text-amber-400'}`}>
          {policy.revoked ? 'REVOKED' : policy.active ? 'ACTIVE' : 'EXPIRED'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Agent ID"    value={String(policy.agentId)} />
        <Field label="Nonce"       value={String(policy.policyId)} />
        <Field label="Created"     value={new Date(policy.createdAt * 1000).toLocaleDateString()} />
        <Field label="Updated"     value={new Date(policy.updatedAt * 1000).toLocaleDateString()} />
        {policy.expiresAt > 0 && (
          <Field label="Expires" value={new Date(policy.expiresAt * 1000).toLocaleDateString()} />
        )}
      </div>
      {policy.policyHash && (
        <Field label="Policy hash" value={policy.policyHash} mono />
      )}
    </div>
  )
}

export function PassportAuthorization({ address }: Props) {
  const { data, status } = usePassportPolicies(address)
  const contractDeployed = Boolean(PASSPORT_CONTRACTS.policyRegistry)

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">AUTHORIZATION POLICIES</h2>

      {!contractDeployed && (
        <div className="border border-amber-400/30 rounded p-4 space-y-1">
          <p className="font-mono text-[10px] text-amber-400">AgentPolicyRegistry not deployed</p>
          <p className="font-mono text-[9px] text-averis-muted">Passport contracts are deploying to Robinhood Chain Testnet (chain {RH_TESTNET.id}). Set VITE_PASSPORT_POLICY_REGISTRY once the address is confirmed.</p>
        </div>
      )}

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading policies...</p>}
      {status === 'error'   && <p className="font-mono text-[11px] text-red-400">Failed to load policies.</p>}

      {status === 'ok' && data?.policies && (
        data.policies.length > 0 ? (
          <div className="space-y-3">
            <p className="font-mono text-[9px] text-averis-muted">{data.policies.length} policy commitment{data.policies.length > 1 ? 's' : ''} • Nonce: {data.nonce}</p>
            {data.policies.map((p: any) => <PolicyCard key={p.policyId} policy={p} />)}
          </div>
        ) : (
          <div className="border border-averis-line rounded p-5 space-y-2">
            <p className="font-mono text-[11px] text-averis-muted">No policy commitments recorded.</p>
            <p className="font-mono text-[10px] text-averis-muted/60">
              Agents can commit policy hashes via EIP-712 signed messages to AgentPolicyRegistry.
              This creates an immutable onchain record of policy versions and revocations.
            </p>
          </div>
        )
      )}

      <div className="border border-averis-line/40 rounded p-4 space-y-2">
        <h3 className="font-mono text-[9px] tracking-widest text-averis-muted uppercase">Contract</h3>
        <Field label="AgentPolicyRegistry" value={contractDeployed ? PASSPORT_CONTRACTS.policyRegistry : 'Deploying...'} mono />
        <Field label="Chain" value={`Robinhood Chain Testnet (${RH_TESTNET.id})`} />
        <p className="font-mono text-[9px] text-averis-muted/60">EIP-712 policy commitments. Revocation is irreversible. Domain-separated from Averis Bank financing.</p>
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[9px] text-averis-muted uppercase">{label}</p>
      <p className={`font-mono ${mono ? 'text-[9px]' : 'text-[10px]'} text-averis-text break-all`}>{value}</p>
    </div>
  )
}
