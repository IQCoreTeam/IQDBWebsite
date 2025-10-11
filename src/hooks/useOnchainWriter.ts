'use client'

import { useCallback, useMemo, useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import type { Idl } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import { initializeRootWeb, createTableWeb, writeRowWeb, pushDbInstructionWeb, type EditMode } from '@/lib/onchainDB'

export type UseOnchainWriterOptions = {
  // IDL object or URL to fetch (one of them must be provided)
  idl?: Idl
  idlUrl?: string
}

export type UseOnchainWriterState = {
  ready: boolean
  loading: boolean
  error: string | null
  lastSignature: string | null
  loadIdl: (url?: string) => Promise<void>
  initializeRoot: () => Promise<string | null>
  createTable: (tableName: string, columns: string[]) => Promise<string | null>
  writeRow: (tableName: string, row: Record<string, any>) => Promise<string | null>
  pushInstruction: (tableName: string, mode: EditMode, targetTxSig: string, json: Record<string, any>) => Promise<string | null>
}

/**
 * useOnchainWriter
 * - Wraps web writer functions with wallet-adapter and IDL loading.
 */
export function useOnchainWriter(opts: UseOnchainWriterOptions = {}): UseOnchainWriterState {
  const { connection } = useConnection()
  const walletCtx = useWallet()
  const [idl, setIdl] = useState<Idl | null>(opts.idl || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSignature, setLastSignature] = useState<string | null>(null)

  const ready = useMemo(() => !!connection && !!walletCtx.publicKey && !!walletCtx.signTransaction && !!idl, [connection, walletCtx.publicKey, walletCtx.signTransaction, idl])

  const loadIdl = useCallback(async (url?: string) => {
    const src = url || opts.idlUrl || '/idl/iq_database.json'
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`Failed to fetch IDL: ${res.status}`)
      const j = (await res.json()) as Idl
      setIdl(j)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [opts.idlUrl])

  const initializeRoot = useCallback(async () => {
    if (!ready || !idl) {
      setError('Writer not ready (wallet or IDL missing)')
      return null
    }
    if (!walletCtx.publicKey || !walletCtx.signTransaction) {
      setError('Wallet missing sign capability')
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const r = await initializeRootWeb({ connection, wallet: walletCtx as any, idl })
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
      r.tx.feePayer = walletCtx.publicKey
      r.tx.recentBlockhash = blockhash
      r.tx.lastValidBlockHeight = lastValidBlockHeight
      const signed = await walletCtx.signTransaction(r.tx)

      let sig: string
      try {
        sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 0 })
      } catch (err: any) {
        const msg = err?.message || ''
        const already = /already been processed|already processed/i.test(msg)
        const first = signed.signatures?.[0]?.signature
        const derived = first ? bs58.encode(first) : undefined
        if (already && derived) {
          sig = derived
        } else {
          throw err
        }
      }

      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
      setLastSignature(sig)
      return sig
    } catch (e: any) {
      setError(e?.message || String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [ready, idl, connection, walletCtx])

  const createTable = useCallback(async (tableName: string, columns: string[]) => {
    if (!ready || !idl) {
      setError('Writer not ready (wallet or IDL missing)')
      return null
    }
    if (!walletCtx.publicKey || !walletCtx.signTransaction) {
      setError('Wallet missing sign capability')
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const r = await createTableWeb({ connection, wallet: walletCtx as any, idl }, tableName, columns)
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
      r.tx.feePayer = walletCtx.publicKey
      r.tx.recentBlockhash = blockhash
      r.tx.lastValidBlockHeight = lastValidBlockHeight
      const signed = await walletCtx.signTransaction(r.tx)

      let sig: string
      try {
        sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 0 })
      } catch (err: any) {
        const msg = err?.message || ''
        const already = /already been processed|already processed/i.test(msg)
        const first = signed.signatures?.[0]?.signature
        const derived = first ? bs58.encode(first) : undefined
        if (already && derived) {
          sig = derived
        } else {
          throw err
        }
      }

      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
      setLastSignature(sig)
      return sig
    } catch (e: any) {
      setError(e?.message || String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [ready, idl, connection, walletCtx])

  const writeRow = useCallback(async (tableName: string, row: Record<string, any>) => {
    if (!ready || !idl) {
      setError('Writer not ready (wallet or IDL missing)')
      return null
    }
    if (!walletCtx.publicKey || !walletCtx.signTransaction) {
      setError('Wallet missing sign capability')
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const r = await writeRowWeb({ connection, wallet: walletCtx as any, idl }, tableName, JSON.stringify(row))
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
      r.tx.feePayer = walletCtx.publicKey
      r.tx.recentBlockhash = blockhash
      r.tx.lastValidBlockHeight = lastValidBlockHeight
      const signed = await walletCtx.signTransaction(r.tx)

      let sig: string
      try {
        sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 0 })
      } catch (err: any) {
        const msg = err?.message || ''
        const already = /already been processed|already processed/i.test(msg)
        const first = signed.signatures?.[0]?.signature
        const derived = first ? bs58.encode(first) : undefined
        if (already && derived) {
          sig = derived
        } else {
          throw err
        }
      }

      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
      setLastSignature(sig)
      return sig
    } catch (e: any) {
      setError(e?.message || String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [ready, idl, connection, walletCtx])

  const pushInstruction = useCallback(async (tableName: string, mode: EditMode, targetTxSig: string, json: Record<string, any>) => {
    if (!ready || !idl) {
      setError('Writer not ready (wallet or IDL missing)')
      return null
    }
    if (!walletCtx.publicKey || !walletCtx.signTransaction) {
      setError('Wallet missing sign capability')
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const r = await pushDbInstructionWeb({ connection, wallet: walletCtx as any, idl }, tableName, mode, targetTxSig, JSON.stringify(json))
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
      r.tx.feePayer = walletCtx.publicKey
      r.tx.recentBlockhash = blockhash
      r.tx.lastValidBlockHeight = lastValidBlockHeight
      const signed = await walletCtx.signTransaction(r.tx)

      let sig: string
      try {
        sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 0 })
      } catch (err: any) {
        const msg = err?.message || ''
        const already = /already been processed|already processed/i.test(msg)
        const first = signed.signatures?.[0]?.signature
        const derived = first ? bs58.encode(first) : undefined
        if (already && derived) {
          sig = derived
        } else {
          throw err
        }
      }

      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
      setLastSignature(sig)
      return sig
    } catch (e: any) {
      setError(e?.message || String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [ready, idl, connection, walletCtx])

  return {
    ready,
    loading,
    error,
    lastSignature,
    loadIdl,
    initializeRoot,
    createTable,
    writeRow,
    pushInstruction,
  }
}
