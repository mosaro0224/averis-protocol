import { useState, useEffect } from 'react'
import { API_BASE } from '../../lib/constants'

interface MCPTool {
  name: string
  title: string
  description: string
  annotations?: { readOnlyHint?: boolean }
}

export function PassportMCP() {
  const [tools, setTools] = useState<MCPTool[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/v1/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'tools/list' }),
    })
      .then(r => r.json())
      .then(d => {
        const passportTools = (d.tools ?? []).filter((t: MCPTool) => t.name.includes('passport'))
        setTools(passportTools)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="w-full px-8 py-8 space-y-6">
      <div>
        <div className="font-mono text-[10px] tracking-[0.1em] text-averis-muted mb-1">PASSPORT MCP TOOLS</div>
        <p className="text-xs text-averis-muted">
          10 MCP tools available at <code className="text-averis-text2">POST {API_BASE}/v1/mcp</code>.
          Agents can discover and use these tools via the Model Context Protocol.
        </p>
      </div>

      {loading && <div className="font-mono text-[10px] text-averis-muted">Loading tools…</div>}

      {!loading && tools.length === 0 && (
        <div className="border border-dashed border-averis-line p-5 font-mono text-[10px] text-averis-muted text-center">
          Tools not loaded — API may be offline
        </div>
      )}

      <div className="space-y-3">
        {tools.map(t => (
          <div key={t.name} className="border border-averis-line p-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-averis-text">{t.title}</span>
              <span className={`font-mono text-[8px] tracking-[0.06em] px-1.5 py-0.5 border ${
                t.annotations?.readOnlyHint
                  ? 'border-averis-line text-averis-muted'
                  : 'border-yellow-900/40 text-yellow-500'
              }`}>
                {t.annotations?.readOnlyHint ? 'READ' : 'WRITE'}
              </span>
            </div>
            <div className="font-mono text-[8px] text-averis-muted">{t.name}</div>
            <p className="text-xs text-averis-muted text-pretty">{t.description}</p>
          </div>
        ))}
      </div>

      {/* Usage example */}
      <div className="border border-averis-line p-4 space-y-2">
        <div className="font-mono text-[9px] tracking-[0.08em] text-averis-muted">EXAMPLE CALL</div>
        <pre className="font-mono text-[9px] text-averis-text2 overflow-x-auto">{`POST ${API_BASE}/v1/mcp
{
  "method": "tools/call",
  "params": {
    "name": "averis_passport_summary",
    "arguments": {
      "walletAddress": "0x..."
    }
  }
}`}</pre>
      </div>
    </div>
  )
}
