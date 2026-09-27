import { useState } from 'react'
import { usePassportCapabilities } from '../../hooks/usePassport'
import { CAPABILITY_TYPES } from '../../lib/passportConstants'

interface Props { address: string }

export function PassportCapabilities({ address }: Props) {
  const { data, status, update } = usePassportCapabilities(address)
  const [editing, setEditing]  = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving]    = useState(false)

  const startEdit = () => {
    setSelected(data.map((c: any) => c.type))
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    await update(selected.map(type => ({ type, label: CAPABILITY_TYPES.find(c => c.type === type)?.label ?? type })))
    setSaving(false)
    setEditing(false)
  }

  const toggle = (type: string) => {
    setSelected(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-[11px] tracking-[0.18em] text-averis-muted">CAPABILITIES</h2>
        {!editing && (
          <button onClick={startEdit} className="font-mono text-[9px] text-blue-400 hover:text-blue-300 border border-blue-400/30 rounded px-3 py-1 bg-transparent cursor-pointer">
            EDIT
          </button>
        )}
      </div>

      {status === 'loading' && <p className="font-mono text-[11px] text-averis-muted">Loading...</p>}

      {status === 'ok' && !editing && (
        data.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {data.map((c: any) => (
              <span key={c.type} className="font-mono text-[10px] text-averis-text border border-averis-line rounded px-3 py-1">
                {c.label ?? c.type}
              </span>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[11px] text-averis-muted">No capabilities declared. Click EDIT to add capabilities.</p>
        )
      )}

      {editing && (
        <div className="space-y-4">
          <p className="font-mono text-[10px] text-averis-muted">Select capabilities to declare (self-reported):</p>
          <div className="flex flex-wrap gap-2">
            {CAPABILITY_TYPES.map(c => (
              <button
                key={c.type}
                onClick={() => toggle(c.type)}
                className={[
                  'font-mono text-[10px] border rounded px-3 py-1.5 cursor-pointer transition-colors bg-transparent',
                  selected.includes(c.type)
                    ? 'border-blue-400 text-blue-400'
                    : 'border-averis-line text-averis-muted hover:border-averis-text',
                ].join(' ')}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="font-mono text-[10px] bg-blue-500 hover:bg-blue-400 text-white border-0 rounded px-4 py-1.5 cursor-pointer"
            >
              {saving ? 'SAVING...' : 'SAVE'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="font-mono text-[10px] text-averis-muted hover:text-averis-text border border-averis-line rounded px-4 py-1.5 cursor-pointer bg-transparent"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      <div className="border border-averis-line/40 rounded p-4">
        <p className="font-mono text-[9px] text-averis-muted/60">
          Capabilities are self-declared and stored offchain. Future versions will support onchain attestation via the AgentPolicyRegistry.
        </p>
      </div>
    </div>
  )
}
