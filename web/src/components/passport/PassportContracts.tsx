/**
 * PassportContracts — displays the Passport contract addresses once deployed.
 * Shows truthful "not yet deployed" state when env vars are missing.
 */

const CONTRACTS = [
  {
    name: 'AgentPolicyRegistry',
    description: 'Non-custodial EIP-712 policy commitment and cross-chain identity linking.',
    envVarRH:  'PASSPORT_POLICY_REGISTRY_RH',
    envVarArc: 'PASSPORT_POLICY_REGISTRY_ARC',
  },
  {
    name: 'AgentReceiptRegistry',
    description: 'Append-only economic receipt anchoring with three verification tiers.',
    envVarRH:  'PASSPORT_RECEIPT_REGISTRY_RH',
    envVarArc: 'PASSPORT_RECEIPT_REGISTRY_ARC',
  },
]

interface ContractRow {
  name: string
  description: string
  rhAddress?: string
  arcAddress?: string
}

export function PassportContracts({ rhAddresses, arcAddresses }: {
  rhAddresses?: { policyRegistry?: string; receiptRegistry?: string }
  arcAddresses?: { policyRegistry?: string; receiptRegistry?: string }
}) {
  const rows: ContractRow[] = [
    {
      name: 'AgentPolicyRegistry',
      description: 'Non-custodial EIP-712 policy commitment and cross-chain identity linking.',
      rhAddress:  rhAddresses?.policyRegistry,
      arcAddress: arcAddresses?.policyRegistry,
    },
    {
      name: 'AgentReceiptRegistry',
      description: 'Append-only economic receipt anchoring with three verification tiers.',
      rhAddress:  rhAddresses?.receiptRegistry,
      arcAddress: arcAddresses?.receiptRegistry,
    },
  ]

  return (
    <div className="w-full px-8 py-8 space-y-6">
      <div>
        <div className="font-mono text-[10px] tracking-[0.1em] text-averis-muted mb-1">PASSPORT CONTRACTS</div>
        <p className="text-xs text-averis-muted">
          Exactly two new contracts. No fund custody. Deployed on Robinhood Chain Testnet (chain 46630)
          with cross-chain identity linking back to Arc Testnet.
        </p>
      </div>

      <div className="space-y-4">
        {rows.map(r => (
          <div key={r.name} className="border border-averis-line p-4 space-y-3">
            <div>
              <div className="font-mono text-[11px] text-averis-text">{r.name}</div>
              <p className="text-xs text-averis-muted mt-1">{r.description}</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-averis-muted">RH Testnet (46630)</span>
                {r.rhAddress ? (
                  <a
                    href={`https://explorer.testnet.chain.robinhood.com/address/${r.rhAddress}`}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[9px] text-averis-green hover:underline no-underline"
                  >
                    {r.rhAddress.slice(0, 10)}…{r.rhAddress.slice(-6)}
                  </a>
                ) : (
                  <span className="font-mono text-[9px] text-averis-muted">not deployed</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-averis-muted">Arc Testnet (5042002)</span>
                {r.arcAddress ? (
                  <a
                    href={`https://explorer.testnet.arc.io/address/${r.arcAddress}`}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[9px] text-averis-green hover:underline no-underline"
                  >
                    {r.arcAddress.slice(0, 10)}…{r.arcAddress.slice(-6)}
                  </a>
                ) : (
                  <span className="font-mono text-[9px] text-averis-muted">not deployed</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="border border-averis-line p-4">
        <div className="font-mono text-[9px] tracking-[0.08em] text-averis-muted mb-2">ERC-8004 IDENTITY REGISTRY</div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] text-averis-muted">testnet canonical</span>
          <a
            href="https://explorer.testnet.arc.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e"
            target="_blank" rel="noopener noreferrer"
            className="font-mono text-[9px] text-averis-text2 hover:text-averis-text no-underline transition-colors"
          >
            0x8004A818…94BD9e
          </a>
        </div>
        <p className="text-[10px] text-averis-muted mt-2">
          CREATE2-deterministic. Averis does not deploy a competing registry.
        </p>
      </div>
    </div>
  )
}
