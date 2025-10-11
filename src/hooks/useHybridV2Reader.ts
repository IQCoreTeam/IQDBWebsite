'use client'

import { useState, useCallback } from 'react'

export interface HybridV2SessionMetadata {
  owner: string
  sessionId: string
  totalChunks: number
  merkleRoot: string
  status: 'active' | 'finalized'
  storageAccount: string
}

export interface HybridV2ReadResult {
  metadata: HybridV2SessionMetadata
  reconstructedData: Buffer
  decompressedData?: Buffer
  chunksFound: number
  totalChunks: number
  fileType?: string
  preview?: string
}

export function useHybridV2Reader() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<HybridV2ReadResult | null>(null)

  const fetchSessionData = useCallback(async (sessionPubkey: string, rpcUrl?: string) => {
    setLoading(true)
    setError(null)
    setData(null)

    try {
      const rpc = rpcUrl || process.env.NEXT_PUBLIC_HYBRID_RPC || 'https://rpc.zeroblock.io'

      // Call server-side API route instead of direct RPC
      const response = await fetch('/api/read-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionPubkey,
          rpcUrl: rpc,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const result = await response.json()

      // Convert base64 strings back to Buffers
      const processedResult: HybridV2ReadResult = {
        ...result,
        reconstructedData: Buffer.from(result.reconstructedData, 'base64'),
        decompressedData: result.decompressedData
          ? Buffer.from(result.decompressedData, 'base64')
          : undefined,
      }

      setData(processedResult)
      return processedResult
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      setError(errMsg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return {
    loading,
    error,
    data,
    fetchSessionData,
    clear,
  }
}
