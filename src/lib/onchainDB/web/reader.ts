// Web-friendly Reader API (shape and types for UI usage)
// Keep inputs simple (strings, numbers). Return serialized JSON-friendly results.
'use client'
import * as anchor from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import { Connection, PublicKey, ParsedTransactionWithMeta, ConfirmedSignatureInfo } from '@solana/web3.js'
import bs58 from 'bs58'
import { configs } from '../configs'
import { pdaRoot, pdaTable, pdaTxRef, pdaInstructionTable } from '../provider/pda.provider'

export type Row = Record<string, any>

export type ReaderParams = {
  // Optional externally-provided connection; falls back to configs.network
  connection?: Connection
  // RPC endpoint to use when no connection is provided
  endpoint?: string
  // Required: user public key in base58
  userPublicKey: string
  // Optional: program id override (base58)
  programId?: string
  // Optional IDL to decode accounts/instructions on web
  idl?: Idl
  // Optional limits for scanning
  maxTx?: number
  perTableLimit?: number
}

export type ReaderResult = {
  // PDAs used during read
  meta: {
    rootPda: string
    txRefPda: string
    programId: string
    endpoint: string
  }
  // Table names if available
  tableNames: string[]
  // Tables meta (columns and PDA strings)
  tables: Record<string, { columns: string[]; tablePda: string; instPda: string | null }>
  // Rows keyed by table
  rowsByTable: Record<string, Row[]>
}

/**
 * readRecentRows
 * - Web-facing reader entry.
 * - Keeps inputs simple and returns JSON-serializable output.
 * - Implementation TODO: decode program-specific instructions using IDL (client-provided)
 *   and scan TxRef PDA signatures similar to core/reader logic.
 */
// Web reader API - scan recent txs for TxRef PDA and decode using IDL

const enc = new TextEncoder()
const toStr = (u8: any) => {
  try {
    if (typeof u8 === 'string') return u8
    if (u8 instanceof Uint8Array) return new TextDecoder().decode(u8)
    if (Array.isArray(u8)) return new TextDecoder().decode(new Uint8Array(u8))
    if (u8?.data) return new TextDecoder().decode(new Uint8Array(u8.data))
    return String(u8 ?? '')
  } catch {
    return String(u8 ?? '')
  }
}
const toU8 = (x: any): Uint8Array => {
  if (x instanceof Uint8Array) return x
  if (Array.isArray(x)) return new Uint8Array(x)
  if (x?.data) return new Uint8Array(x.data)
  return new Uint8Array()
}

function makeAccountsCoder(idl: Idl) {
  return new anchor.BorshAccountsCoder(idl)
}
function makeIxCoder(idl: Idl) {
  return new anchor.BorshInstructionCoder(idl)
}

async function fetchAndDecode<T = any>(
  connection: Connection,
  coder: anchor.BorshAccountsCoder,
  pubkey: PublicKey,
  accountName: 'Root' | 'Table' | 'TxRef' | 'InstructionTable'
): Promise<T | null> {
  const info = await connection.getAccountInfo(pubkey)
  if (!info) return null
  return coder.decode(accountName, info.data) as T
}

async function readRootAndTables(
  connection: Connection,
  idl: Idl,
  user: PublicKey
) {
  const accCoder = makeAccountsCoder(idl)
  const rootPda = pdaRoot(user)
  const root = await fetchAndDecode<any>(connection, accCoder, rootPda, 'Root')
  if (!root) {
    return { rootPda, creator: null as string | null, tableNames: [] as string[], tables: {} as Record<string, { columns: string[]; tablePda: PublicKey; instPda: PublicKey | null }> }
  }
  const creator = new PublicKey(root.creator).toBase58()
  const tableNames: string[] = (root.table_names ?? []).map((v: any) => toStr(v))
  const tables: Record<string, { columns: string[]; tablePda: PublicKey; instPda: PublicKey | null }> = {}

  for (const name of tableNames) {
    const seed = enc.encode(name)
    const tablePda = pdaTable(rootPda, seed)
    const instPda = pdaInstructionTable(rootPda, seed)
    const tableAcc = await fetchAndDecode<any>(connection, accCoder, tablePda, 'Table')
    const columns = tableAcc ? (tableAcc.column_names ?? []).map((v: any) => toStr(v)) : []
    tables[name] = { columns, tablePda, instPda }
  }
  return { rootPda, creator, tableNames, tables }
}

async function getSignaturesFor(address: PublicKey, connection: Connection, limit: number) {
  const out: ConfirmedSignatureInfo[] = []
  let before: string | undefined = undefined
  while (out.length < limit) {
    const chunk = await connection.getSignaturesForAddress(address, { limit: Math.min(1000, limit - out.length), before })
    if (chunk.length === 0) break
    out.push(...chunk)
    before = chunk[chunk.length - 1].signature
  }
  return out
}

function decodeAllIxsFromTx(
  tx: ParsedTransactionWithMeta,
  programIdB58: string,
  ixCoder: anchor.BorshInstructionCoder
) {
  const accKeys = tx.transaction?.message?.accountKeys ?? []
  const out: { name: string; data: any }[] = []

  const outer = tx.transaction?.message?.instructions ?? []
  const innerGroups = tx.meta?.innerInstructions ?? []
  const inner = innerGroups.flatMap((g) => g.instructions ?? [])
  const all = [...outer, ...inner]

  for (const ix of all) {
    const pidIndex = (ix as any).programIdIndex
    const pid = pidIndex != null ? (accKeys[pidIndex]?.pubkey || accKeys[pidIndex]) : (ix as any).programId
    const pidB58 = typeof (pid as any)?.toBase58 === 'function' ? (pid as any).toBase58() : String(pid)
    if (pidB58 !== programIdB58) continue
    const data = (ix as any).data
    if (!data) continue
    try {
      const decoded = ixCoder.decode(typeof data === 'string' ? data : bs58.encode(toU8(data)), 'base58')
      if (decoded) out.push(decoded)
    } catch {
      // skip
    }
  }
  return out
}

function tryParseJsonLoose(s: string): Row {
  if (!s) return {}
  let normalized = s.trim()
  if (!/^\s*\{/.test(normalized)) {
    return { value: normalized }
  }
  normalized = normalized.replace(/'([^']*)'/g, (_m, g1) => `"${g1}"`).replace(/(\w+)\s*:/g, `"$1":`)
  try {
    return JSON.parse(normalized)
  } catch {
    try {
      const fixed = normalized.replace(/(\{|,)\s*([A-Za-z0-9_]+)\s*:/g, `$1 "$2":`)
      return JSON.parse(fixed)
    } catch {
      return { raw: s }
    }
  }
}

function pushRow(byTable: Record<string, Row[]>, tableName: string, row: Row) {
  if (!byTable[tableName]) byTable[tableName] = []
  byTable[tableName].push(row)
}

async function collectRowsFromTxRef(
  connection: Connection,
  programId: PublicKey,
  ixCoder: anchor.BorshInstructionCoder,
  txRefPda: PublicKey,
  maxCount: number
): Promise<Record<string, Row[]>> {
  const programIdB58 = programId.toBase58()
  const sigs = await getSignaturesFor(txRefPda, connection, maxCount)
  const byTable: Record<string, Row[]> = {}

  for (const s of sigs) {
    const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
    if (!tx) continue
    const decoded = decodeAllIxsFromTx(tx as any, programIdB58, ixCoder)
    for (const d of decoded) {
      try {
        if (d.name === 'write_data') {
          const tableName = toStr(d.data.table_name ?? d.data[0])
          const payloadStr = toStr(d.data.row_json_tx ?? d.data[1])
          pushRow(byTable, tableName, tryParseJsonLoose(payloadStr))
        } else if (d.name === 'database_instruction') {
          const tableName = toStr(d.data.table_name ?? d.data[0])
          const contentStr = toStr(d.data.content_json_tx ?? d.data[3])
          pushRow(byTable, tableName, tryParseJsonLoose(contentStr))
        }
      } catch {
        // ignore malformed
      }
    }
  }
  return byTable
}

/**
 * readRecentRows
 * - Web-friendly reader entry: returns JSON result.
 */
export async function readRecentRows(params: ReaderParams): Promise<ReaderResult> {
  const endpoint = params.endpoint || configs.network
  const connection = params.connection || new Connection(endpoint, 'confirmed')
  const programIdStr = params.programId || configs.programId
  const user = new PublicKey(params.userPublicKey)
  const idl = params.idl

  // Compute PDAs (always safe on web)
  const root = pdaRoot(user)
  const txRef = pdaTxRef(user)

  // If no IDL, return metadata only (tables/rows empty)
  if (!idl) {
    return {
      meta: {
        rootPda: root.toBase58(),
        txRefPda: txRef.toBase58(),
        programId: programIdStr,
        endpoint,
      },
      tableNames: [],
      tables: {},
      rowsByTable: {},
    }
  }

  // With IDL: read root/tables and scan recent txs touching txRef
  const { tableNames, tables: tablesMeta } = await (async () => {
    const { tableNames, tables } = await readRootAndTables(connection, idl, user)
    // convert PDAs to base58 for JSON-friendly output
    const outTables: Record<string, { columns: string[]; tablePda: string; instPda: string | null }> = {}
    for (const [name, meta] of Object.entries(tables)) {
      outTables[name] = {
        columns: meta.columns,
        tablePda: meta.tablePda.toBase58(),
        instPda: meta.instPda ? meta.instPda.toBase58() : null,
      }
    }
    return { tableNames, tables: outTables }
  })()

  const rowsByTable = await (async () => {
    const ixCoder = makeIxCoder(idl)
    const byTable = await collectRowsFromTxRef(
      connection,
      new PublicKey(programIdStr),
      ixCoder,
      txRef,
      params.maxTx || 100
    )
    // honor perTableLimit if provided
    const limited: Record<string, Row[]> = {}
    for (const [name, rows] of Object.entries(byTable)) {
      limited[name] = params.perTableLimit ? rows.slice(0, params.perTableLimit) : rows
    }
    return limited
  })()

  return {
    meta: {
      rootPda: root.toBase58(),
      txRefPda: txRef.toBase58(),
      programId: programIdStr,
      endpoint,
    },
    tableNames,
    tables: tablesMeta,
    rowsByTable,
  }
}

/**
 * readRowsByTable
 * - 지정한 테이블 이름의 로우만 스캔/디코딩해서 반환
 */
export async function readRowsByTable(
  params: ReaderParams & { tableName: string }
): Promise<Row[]> {
  const endpoint = params.endpoint || configs.network
  const connection = params.connection || new Connection(endpoint, 'confirmed')
  const programIdStr = params.programId || configs.programId
  const user = new PublicKey(params.userPublicKey)
  const idl = params.idl
  const tableName = params.tableName
  const maxTx = params.maxTx || 100
  const perTableLimit = params.perTableLimit

  if (!idl) return []

  const txRef = pdaTxRef(user)
  const ixCoder = makeIxCoder(idl)
  const programId = new PublicKey(programIdStr)
  const byTable = await collectRowsFromTxRef(connection, programId, ixCoder, txRef, maxTx)
  const rows = byTable[tableName] || []
  return perTableLimit ? rows.slice(0, perTableLimit) : rows
}
