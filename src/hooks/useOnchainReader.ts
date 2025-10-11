'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Connection, clusterApiUrl } from '@solana/web3.js'
import type { Idl } from '@coral-xyz/anchor'
import { readRecentRows, type ReaderResult } from '@/lib/onchainDB'

type Net = 'devnet' | 'mainnet-beta' | 'custom'

export type UseOnchainReaderOptions = {
  // Required: user public key (base58)
  userPublicKey: string
  // Network selection
  network?: Net
  // Custom endpoint used when network === 'custom'
  endpoint?: string
  // IDL url to fetch
  idlUrl?: string
  // Scan limits
  maxTx?: number
  perTableLimit?: number
  // Auto fetch on mount
  auto?: boolean
  // Retry options
  retry?: { attempts?: number; delayMs?: number }
}

export type UseOnchainReaderState = {
  loading: boolean
  error: string | null
  data: ReaderResult | null
  idl: Idl | null
  refresh: () => Promise<void>
}

/** Resolve endpoint string based on selected network and optional custom endpoint. */
function resolveEndpoint(network: Net = 'devnet', endpoint?: string) {
  if (network === 'devnet') return clusterApiUrl('devnet')
  if (network === 'mainnet-beta') return clusterApiUrl('mainnet-beta')
  if (network === 'custom' && endpoint) return endpoint
  return clusterApiUrl('devnet')
}

/** Simple retry wrapper for async operations. */
async function retryAsync<T>(fn: () => Promise<T>, attempts = 3, delayMs = 600): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }
  throw lastErr
}

/**
 * useOnchainReader
 * - Loads IDL (via fetch) and calls readRecentRows, returning JSON-friendly data.
 * - Provides loading/error state and a refresh function.
 */
export function useOnchainReader(opts: UseOnchainReaderOptions): UseOnchainReaderState {
  const {
    userPublicKey,
    network = 'devnet',
    endpoint,
    idlUrl = '/idl/iq_database.json',
    maxTx,
    perTableLimit,
    auto = true,
    retry = { attempts: 2, delayMs: 500 },
  } = opts

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ReaderResult | null>(null)
  const [idl, setIdl] = useState<Idl | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const resolvedEndpoint = useMemo(() => resolveEndpoint(network, endpoint), [network, endpoint])

  const load = useCallback(async () => {
    if (!userPublicKey) {
      setError('Missing userPublicKey')
      return
    }
    setLoading(true)
    setError(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      // Fetch IDL
      const loadedIdl = await retryAsync<Idl>(async () => {
        const res = await fetch(idlUrl, { signal: controller.signal })
        if (!res.ok) throw new Error(`Failed to fetch IDL: ${res.status}`)
        return (await res.json()) as Idl
      }, retry.attempts, retry.delayMs)
      setIdl(loadedIdl)

      const connection = new Connection(resolvedEndpoint, 'confirmed')
      // Call reader
      const result = await readRecentRows({
        connection,
        endpoint: resolvedEndpoint,
        userPublicKey,
        programId: (loadedIdl as any).address,
        idl: loadedIdl,
        maxTx,
        perTableLimit,
      })
      setData(result)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [userPublicKey, idlUrl, resolvedEndpoint, maxTx, perTableLimit, retry.attempts, retry.delayMs])

  useEffect(() => {
    if (auto) {
      load()
    }
    return () => {
      abortRef.current?.abort()
    }
  }, [load, auto])

  return { loading, error, data, idl, refresh: load }
}
