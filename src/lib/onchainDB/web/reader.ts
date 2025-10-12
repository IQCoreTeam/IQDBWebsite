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

async function readTableListFromRoot(
  connection: Connection,
  idl: Idl,
  user: PublicKey
) {
  const accCoder = makeAccountsCoder(idl)
  const rootPda = pdaRoot(user)
  const root = await fetchAndDecode<any>(connection, accCoder, rootPda, 'Root')
  if (!root) {
    return { rootPda, creator: null as string | null, tableNames: [] as string[] }
  }
  const creator = new PublicKey(root.creator).toBase58()
  const tableNames: string[] = (root.table_names ?? []).map((v: any) => toStr(v))
  return { rootPda, creator, tableNames }
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

  // With IDL: read only table list from root (no per-table account reads here)
  const { tableNames } = await readTableListFromRoot(connection, idl, user)

  return {
    meta: {
      rootPda: root.toBase58(),
      txRefPda: txRef.toBase58(),
      programId: programIdStr,
      endpoint,
    },
    tableNames,
    tables: {},
    rowsByTable: {}, // rows are fetched on-demand per table
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

  // Derive PDAs (pure computation, no network read)
  const rootPda = pdaRoot(user)
  const seed = enc.encode(tableName)
  const tablePda = pdaTable(rootPda, seed)
  const instPda = pdaInstructionTable(rootPda, seed)

  // Scan signatures touching both table PDA and instruction PDA (if present)
  const ixCoder = makeIxCoder(idl)
  const programId = new PublicKey(programIdStr)
  const lists = await Promise.all([tablePda, instPda].map(addr => getSignaturesFor(addr, connection, maxTx)))
  const sigMap = new Map<string, ConfirmedSignatureInfo>()
  for (const list of lists) {
    for (const s of list) {
      if (!sigMap.has(s.signature)) sigMap.set(s.signature, s)
    }
  }
  const sigs = Array.from(sigMap.values())
    .sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))
    .slice(0, maxTx)

  const programIdB58 = programId.toBase58()
  const rows: Row[] = []
  for (const s of sigs) {
    const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
    if (!tx) continue
    const decoded = decodeAllIxsFromTx(tx as any, programIdB58, ixCoder)
    for (const d of decoded) {
      try {
        if (d.name === 'write_data') {
          const nameInIx = toStr(d.data.table_name ?? d.data[0])
          if (nameInIx !== tableName) continue
          const payloadStr =
            toStr(d.data.row_json_tx ?? d.data.rowJsonTx ?? d.data[1])
          rows.push(tryParseJsonLoose(payloadStr))
        } else if (d.name === 'database_instruction') {
          const nameInIx = toStr(d.data.table_name ?? d.data[0])
          if (nameInIx !== tableName) continue
          const contentStr =
            toStr(d.data.contentJsonTx ?? d.data.content_json_tx ?? d.data[3])
          rows.push(tryParseJsonLoose(contentStr))
        }
      } catch {
        // skip decode errors
      }
    }
  }

  return perTableLimit ? rows.slice(0, perTableLimit) : rows
}

/**
 * readTableMeta
 * - 지정한 테이블 이름의 컬럼 메타와 PDA(base58)를 반환
 * - root를 재조회하지 않고 user + tableName으로 PDA를 계산하고,
 *   Table 계정을 디코딩하여 column_names만 읽습니다.
 */
export async function readTableMeta(
  params: ReaderParams & { tableName: string }
): Promise<{ columns: string[]; tablePda: string; instPda: string | null }> {
  const endpoint = params.endpoint || configs.network
  const connection = params.connection || new Connection(endpoint, 'confirmed')
  const user = new PublicKey(params.userPublicKey)
  const idl = params.idl
  const tableName = params.tableName

  // PDA 계산(순수 연산)
  const rootPda = pdaRoot(user)
  const seed = new TextEncoder().encode(tableName)
  const tablePda = pdaTable(rootPda, seed)
  const instPda = pdaInstructionTable(rootPda, seed)

  if (!idl) {
    return { columns: [], tablePda: tablePda.toBase58(), instPda: instPda ? instPda.toBase58() : null }
  }

  // Table 계정에서 columns 메타만 디코딩
  const accCoder = makeAccountsCoder(idl)
  try {
    const tableAcc = await fetchAndDecode<any>(connection, accCoder, tablePda, 'Table')
    const columns = tableAcc ? (tableAcc.column_names ?? []).map((v: any) => toStr(v)) : []
    return { columns, tablePda: tablePda.toBase58(), instPda: instPda ? instPda.toBase58() : null }
  } catch {
    return { columns: [], tablePda: tablePda.toBase58(), instPda: instPda ? instPda.toBase58() : null }
  }
}
