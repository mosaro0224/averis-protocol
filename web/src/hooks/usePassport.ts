/**
 * Passport data hooks — fetch all passport sections from the API.
 * Returns real data or truthful empty states. Never fabricates values.
 */

import { useState, useEffect, useCallback } from 'react'
import { PASSPORT_API } from '../lib/passportConstants'

export type PassportStatus = 'idle' | 'loading' | 'ok' | 'error'

async function fetchPassport<T>(path: string): Promise<T> {
  const res = await fetch(`${PASSPORT_API}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

// ── Full passport profile ──────────────────────────────────────────────────────

export function usePassportProfile(address: string | undefined) {
  const [data, setData] = useState<any>(null)
  const [status, setStatus] = useState<PassportStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!address) return
    setStatus('loading')
    try {
      const d = await fetchPassport(`/v2/agents/${address}/passport`)
      setData(d)
      setStatus('ok')
      setError(null)
    } catch (e: any) {
      setError(e.message)
      setStatus('error')
    }
  }, [address])

  useEffect(() => { load() }, [load])
  return { data, status, error, reload: load }
}

// ── Identity ──────────────────────────────────────────────────────────────────

export function usePassportIdentity(address: string | undefined) {
  const [data, setData] = useState<any>(null)
  const [status, setStatus] = useState<PassportStatus>('idle')

  const load = useCallback(async () => {
    if (!address) return
    setStatus('loading')
    try {
      const d = await fetchPassport(`/v2/agents/${address}/identity`)
      setData(d)
      setStatus('ok')
    } catch {
      setStatus('error')
    }
  }, [address])

  useEffect(() => { load() }, [load])

  return { data, status, reload: load }
}

// ── Capabilities ──────────────────────────────────────────────────────────────

export function usePassportCapabilities(address: string | undefined) {
  const [data, setData] = useState<any[]>([])
  const [status, setStatus] = useState<PassportStatus>('idle')

  const load = useCallback(async () => {
    if (!address) return
    setStatus('loading')
    try {
      const d = await fetchPassport<{ capabilities: any[] }>(`/v2/agents/${address}/capabilities`)
      setData(d.capabilities ?? [])
      setStatus('ok')
    } catch { setStatus('error') }
  }, [address])

  useEffect(() => { load() }, [load])

  const update = useCallback(async (capabilities: any[]) => {
    if (!address) return
    await fetch(`${PASSPORT_API}/v2/agents/${address}/capabilities`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities }),
    })
    await load()
  }, [address, load])

  return { data, status, update, reload: load }
}

// ── Policies ──────────────────────────────────────────────────────────────────

export function usePassportPolicies(address: string | undefined) {
  const [data, setData] = useState<any>(null)
  const [status, setStatus] = useState<PassportStatus>('idle')

  useEffect(() => {
    if (!address) return
    setStatus('loading')
    fetchPassport(`/v2/agents/${address}/policies`)
      .then(d => { setData(d); setStatus('ok') })
      .catch(() => setStatus('error'))
  }, [address])

  return { data, status }
}

// ── Reputation ─────────────────────────────────────────────────────────────────

export function usePassportReputation(address: string | undefined) {
  const [data, setData] = useState<any>(null)
  const [status, setStatus] = useState<PassportStatus>('idle')

  useEffect(() => {
    if (!address) return
    setStatus('loading')
    fetchPassport(`/v2/agents/${address}/reputation`)
      .then(d => { setData(d); setStatus('ok') })
      .catch(() => setStatus('error'))
  }, [address])

  return { data, status }
}

// ── Risk ──────────────────────────────────────────────────────────────────────

export function usePassportRisk(address: string | undefined) {
  const [data, setData] = useState<any>(null)
  const [status, setStatus] = useState<PassportStatus>('idle')

  useEffect(() => {
    if (!address) return
    setStatus('loading')
    fetchPassport(`/v2/agents/${address}/risk`)
      .then(d => { setData(d); setStatus('ok') })
      .catch(() => setStatus('error'))
  }, [address])

  return { data, status }
}

// ── Transactions ──────────────────────────────────────────────────────────────

export function usePassportTransactions(address: string | undefined, filters?: { type?: string; status?: string }) {
  const [data, setData] = useState<any>(null)
  const [status, setStatus] = useState<PassportStatus>('idle')

  useEffect(() => {
    if (!address) return
    setStatus('loading')
    const params = new URLSearchParams()
    if (filters?.type)   params.set('type', filters.type)
    if (filters?.status) params.set('status', filters.status)
    fetchPassport(`/v2/agents/${address}/transactions?${params}`)
      .then(d => { setData(d); setStatus('ok') })
      .catch(() => setStatus('error'))
  }, [address, filters?.type, filters?.status])

  return { data, status }
}

// ── Counterparties ─────────────────────────────────────────────────────────────

export function usePassportCounterparties(address: string | undefined) {
  const [data, setData] = useState<any[]>([])
  const [status, setStatus] = useState<PassportStatus>('idle')

  useEffect(() => {
    if (!address) return
    setStatus('loading')
    fetchPassport<{ counterparties: any[] }>(`/v2/agents/${address}/counterparties`)
      .then(d => { setData(d.counterparties ?? []); setStatus('ok') })
      .catch(() => setStatus('error'))
  }, [address])

  return { data, status }
}

// ── Receipts ──────────────────────────────────────────────────────────────────

export function usePassportReceipts(address: string | undefined) {
  const [data, setData] = useState<any>(null)
  const [status, setStatus] = useState<PassportStatus>('idle')

  useEffect(() => {
    if (!address) return
    setStatus('loading')
    fetchPassport(`/v2/agents/${address}/receipts`)
      .then(d => { setData(d); setStatus('ok') })
      .catch(() => setStatus('error'))
  }, [address])

  return { data, status }
}

// ── Agreements ─────────────────────────────────────────────────────────────────

export function usePassportAgreements(address: string | undefined) {
  const [data, setData] = useState<any[]>([])
  const [status, setStatus] = useState<PassportStatus>('idle')

  useEffect(() => {
    if (!address) return
    setStatus('loading')
    fetchPassport<{ agreements: any[] }>(`/v2/agents/${address}/agreements`)
      .then(d => { setData(d.agreements ?? []); setStatus('ok') })
      .catch(() => setStatus('error'))
  }, [address])

  return { data, status }
}
