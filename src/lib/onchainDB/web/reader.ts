// Web-friendly Reader API (shape and types for UI usage)
// Keep inputs simple (strings, numbers). Return serialized JSON-friendly results.
'use client'
import * as anchor from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import { Connection, PublicKey, ParsedTransactionWithMeta, ConfirmedSignatureInfo } from '@solana/web3.js'
import bs58 from 'bs58'
import { Buffer } from 'buffer'
import { configs } from '../configs'
import { deriveSeedHex } from '../core/seed'
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
  // Table identifiers (seed hex strings)
  tableNames: string[]
  tableDisplayNames: Record<string, string>
  // Tables meta (columns, id/ext info and PDA strings)
  tables: Record<
    string,
    {
      name: string
      columns: string[]
      idColumn?: string | number | null
      extTableName?: string | null
      extKeys?: string[]
      tablePda: string
      instPda: string | null
    }
  >
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

const isPrintableAscii = (s: string) => /^[\x20-\x7E]+$/.test(s)

const toStr = (u8: any) => {
  try {
    if (typeof u8 === 'string') return u8
    const bytes = toU8(u8)
    if (bytes.length === 0) return ''
    try {
      const decoded = new TextDecoder().decode(bytes).replace(/\0+$/, '')
      if (decoded && isPrintableAscii(decoded)) {
        return decoded
      }
    } catch {
      // fall through to hex representation
    }
    return Buffer.from(bytes).toString('hex')
  } catch {
    return Buffer.from(toU8(u8)).toString('hex')
  }
}
const toU8 = (x: any): Uint8Array => {
  if (x instanceof Uint8Array) return x
  if (Array.isArray(x)) return new Uint8Array(x)
  if (x?.data) return new Uint8Array(x.data)
  return new Uint8Array()
}
const toHex = (x: any): string => Buffer.from(toU8(x)).toString('hex')

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
    return {
      rootPda,
      creator: null as string | null,
      tableSeeds: [] as string[],
      globalTableSeeds: [] as string[],
    }
  }
  const creator = new PublicKey(root.creator).toBase58()
  const rawTableSeeds = (root.table_seeds ?? root.tableSeeds ?? root.table_names ?? []) as any[]
  const rawGlobalSeeds = (root.global_table_seeds ?? root.globalTableSeeds ?? root.global_table_names ?? []) as any[]
  const tableSeeds = rawTableSeeds.map((v) => toHex(v))
  const globalTableSeeds = rawGlobalSeeds.map((v) => toHex(v))
  return { rootPda, creator, tableSeeds, globalTableSeeds }
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
          const seedHex = toHex(d.data.table_seed ?? d.data[0])
          const payloadStr = toStr(d.data.row_json_tx ?? d.data[2])
          pushRow(byTable, seedHex, tryParseJsonLoose(payloadStr))
        } else if (d.name === 'database_instruction') {
          const seedHex = toHex(d.data.table_seed ?? d.data[0])
          const contentStr = toStr(d.data.content_json_tx ?? d.data[3])
          pushRow(byTable, seedHex, tryParseJsonLoose(contentStr))
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
      tableDisplayNames: {},
      tables: {},
      rowsByTable: {},
    }
  }

  // With IDL: read table list from root and build tables metadata
  const { tableSeeds } = await readTableListFromRoot(connection, idl, user)
  const accCoder = makeAccountsCoder(idl)
  const tables: ReaderResult['tables'] = {}
  const tableDisplayNames: Record<string, string> = {}

  for (const seedHex of tableSeeds) {
    const tablePda = pdaTable(root, seedHex)
    const instPda = pdaInstructionTable(root, seedHex)
    let columns: string[] = []
    let idColumn: string | number | null | undefined = undefined
    let extTableName: string | null | undefined = undefined
    let extKeys: string[] = []
    let displayName = seedHex

    try {
      const tableAcc = await fetchAndDecode<any>(connection, accCoder, tablePda, 'Table')
      if (tableAcc) {
        displayName = toStr(tableAcc.name ?? tableAcc.table_name ?? seedHex)
        columns = (tableAcc.column_names ?? tableAcc.columns ?? []).map((v: any) => toStr(v))
        // idColumn: try multiple keys, accept string or number
        const idRaw =
          tableAcc.id_column ??
          tableAcc.idColumn ??
          tableAcc.id_index ??
          tableAcc.idIndex ??
          null
        if (typeof idRaw === 'string') {
          idColumn = idRaw
        } else if (typeof idRaw === 'number') {
          idColumn = idRaw
        } else if (idRaw && typeof idRaw === 'object') {
          // bytes → string
          const s = toStr(idRaw)
          idColumn = s || null
        } else {
          idColumn = null
        }
        // extTableName: try multiple keys and cast to string
        const extRaw = tableAcc.ext_table_name ?? tableAcc.extTableName ?? null
        extTableName = extRaw != null ? toStr(extRaw) : null
        const extKeysRaw = (tableAcc.ext_keys ?? tableAcc.extKeys ?? []) as any[]
        if (Array.isArray(extKeysRaw)) {
          extKeys = extKeysRaw.map((v) => toStr(v))
        }
      }
    } catch {
      // best-effort
    }

    // default: first column as id if not provided
    if ((idColumn == null || idColumn === '') && columns.length > 0) {
      idColumn = columns[0]
    }

    tableDisplayNames[seedHex] = displayName
    tables[seedHex] = {
      name: displayName,
      columns,
      idColumn,
      extTableName,
      extKeys,
      tablePda: tablePda.toBase58(),
      instPda: instPda ? instPda.toBase58() : null,
    }
  }

  return {
    meta: {
      rootPda: root.toBase58(),
      txRefPda: txRef.toBase58(),
      programId: programIdStr,
      endpoint,
    },
    tableNames: tableSeeds,
    tableDisplayNames,
    tables,
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

  let idColumnName: string | undefined

  const normalizeRow = (input: Row): Row => {
    if (!input || typeof input !== 'object') return input
    const clone: Row = { ...input }
    if (idColumnName && Object.prototype.hasOwnProperty.call(clone, idColumnName)) {
      try {
        Object.defineProperty(clone, '__rowId', {
          value: (clone as any)[idColumnName],
          enumerable: false,
          configurable: true,
          writable: true,
        })
      } catch {
        ;(clone as any).__rowId = (clone as any)[idColumnName]
      }
    }
    return clone
  }

  // fetch meta for id/ext info
  try {
    const meta = await readTableMeta({ ...params, connection })
    if (typeof meta.idColumn === 'string') {
      idColumnName = meta.idColumn
    } else if (typeof meta.idColumn === 'number' && meta.columns?.[meta.idColumn]) {
      idColumnName = meta.columns[meta.idColumn]
    }
    if (!idColumnName && meta.columns && meta.columns.length > 0) {
      idColumnName = meta.columns[0]
    }
  } catch {
    // ignore, best-effort
  }

  // Derive PDAs (pure computation, no network read)
  const rootPda = pdaRoot(user)
  const tablePda = pdaTable(rootPda, tableName)
  const instPda = pdaInstructionTable(rootPda, tableName)
  const targetSeedHex = deriveSeedHex(tableName)

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
  type WriteRow = { signature: string; row: Row }
  const writeRows: WriteRow[] = []
  const instructionMap = new Map<string, Row>()

  const entriesToRow = (entries: any[]): Row => {
    const out: Row = {}
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const column =
        (entry as any).column ??
        (entry as any).col ??
        (entry as any).key ??
        (entry as any).name ??
        null
      if (!column) continue
      const data =
        (entry as any).data ??
        (entry as any).value ??
        (entry as any).val ??
        (entry as any).dataJson ??
        (entry as any).data_json ??
        null
      out[String(column)] = data
    }
    return out
  }

  const parseInstructionContent = (raw: string): Row => {
    const input = raw ?? ''
    const trimmed = input.trim()
    if (!trimmed) return { __delete: true }
    if (/^\s*\[/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return entriesToRow(parsed)
        }
      } catch {
        // ignore, fall back to loose parser
      }
    }
    const loose = tryParseJsonLoose(input)
    if (loose && typeof loose === 'object') {
      if (Array.isArray((loose as any).updates)) {
        return entriesToRow((loose as any).updates)
      }
      if (Array.isArray((loose as any).rows)) {
        return entriesToRow((loose as any).rows)
      }
      if (Array.isArray((loose as any).data)) {
        return entriesToRow((loose as any).data)
      }
    }
    return loose
  }

  for (const s of sigs) {
    const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
    if (!tx) continue
    const decoded = decodeAllIxsFromTx(tx as any, programIdB58, ixCoder)
    for (const d of decoded) {
      try {
        if (d.name === 'write_data') {
          const seedHex = toHex(d.data.table_seed ?? d.data[0])
          if (seedHex !== targetSeedHex) continue
          const payloadStr = toStr(d.data.row_json_tx ?? d.data.rowJsonTx ?? d.data[1])
          const normalized = normalizeRow(tryParseJsonLoose(payloadStr))
          writeRows.push({ signature: s.signature, row: normalized })
        } else if (d.name === 'database_instruction') {
          const seedHex = toHex(d.data.table_seed ?? d.data[0])
          if (seedHex !== targetSeedHex) continue
          const targetSig = toStr(d.data.target_tx ?? d.data[1])
          if (!targetSig) continue
          if (instructionMap.has(targetSig)) continue
          const contentStr = toStr(d.data.contentJsonTx ?? d.data.content_json_tx ?? d.data[3])
          instructionMap.set(targetSig, parseInstructionContent(contentStr))
        }
      } catch {
        // skip decode errors
      }
    }
  }

  const shouldDelete = (override: Row | undefined): boolean => {
    if (!override || typeof override !== 'object') return false
    const lower = (val: any) => (typeof val === 'string' ? val.toLowerCase() : '')
    if (
      override.delete === true ||
      override.deleted === true ||
      (override as any).__delete === true ||
      lower((override as any).action) === 'delete' ||
      lower((override as any).mode) === 'delete' ||
      lower((override as any).op) === 'delete' ||
      lower((override as any).type) === 'delete' ||
      lower((override as any).status) === 'deleted'
    ) {
      return true
    }
    return false
  }

  const attachHiddenMeta = (row: Row, signature: string): Row => {
    if (!row || typeof row !== 'object') return row
    const clone: Row = { ...row }
    const defineHidden = (key: string, value: string) => {
      try {
        Object.defineProperty(clone, key, {
          value,
          enumerable: false,
          configurable: false,
          writable: false,
        })
      } catch {
        ;(clone as any)[key] = value
      }
    }
    defineHidden('__txSignature', signature)
    defineHidden('__tableSeed', targetSeedHex)
    return clone
  }

  const applyInstruction = (baseRow: Row, override: Row | undefined): Row | null => {
    if (!override) return baseRow
    if (shouldDelete(override as Row)) return null

    const baseClone: Row = baseRow && typeof baseRow === 'object' ? { ...baseRow } : {}
    const baseRowId = (baseRow as any)?.__rowId
    if (baseRowId !== undefined) {
      try {
        Object.defineProperty(baseClone, '__rowId', {
          value: baseRowId,
          enumerable: false,
          configurable: true,
          writable: true,
        })
      } catch {
        ;(baseClone as any).__rowId = baseRowId
      }
    }

    if (typeof override !== 'object') {
      if (override == null) {
        return normalizeRow(baseClone)
      }
      baseClone.value = override
      return normalizeRow(baseClone)
    }

    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) {
        delete (baseClone as any)[key]
      } else {
        baseClone[key] = value
      }
    }

    if (idColumnName) {
      const overrideId = Object.prototype.hasOwnProperty.call(override, idColumnName)
        ? (override as any)[idColumnName]
        : undefined
      if (overrideId !== undefined && overrideId !== null) {
        baseClone[idColumnName] = overrideId
      } else if ((baseClone as any)[idColumnName] == null && (baseRow as any)?.[idColumnName] != null) {
        baseClone[idColumnName] = (baseRow as any)[idColumnName]
      }
      const refreshedId = (baseClone as any)[idColumnName]
      if (refreshedId !== undefined) {
        try {
          Object.defineProperty(baseClone, '__rowId', {
            value: refreshedId,
            enumerable: false,
            configurable: true,
            writable: true,
          })
        } catch {
          ;(baseClone as any).__rowId = refreshedId
        }
      }
    }
    return normalizeRow(baseClone)
  }

  const filteredRows: Row[] = []
  for (const { signature, row } of writeRows) {
    const override = instructionMap.get(signature)
    const applied = applyInstruction(row, override)
    if (applied) filteredRows.push(attachHiddenMeta(applied, signature))
  }

  return perTableLimit ? filteredRows.slice(0, perTableLimit) : filteredRows
}


export async function readTableMeta(
  params: ReaderParams & { tableName: string }
): Promise<{ name: string; columns: string[]; idColumn?: string | number | null; extTableName?: string | null; extKeys?: string[]; tablePda: string; instPda: string | null }> {
  const endpoint = params.endpoint || configs.network
  const connection = params.connection || new Connection(endpoint, 'confirmed')
  const user = new PublicKey(params.userPublicKey)
  const idl = params.idl
  const tableName = params.tableName

  const rootPda = pdaRoot(user)
  const tablePda = pdaTable(rootPda, tableName)
  const instPda = pdaInstructionTable(rootPda, tableName)

  if (!idl) {
    return { name: toStr(tableName), columns: [], idColumn: null, extTableName: null, extKeys: [], tablePda: tablePda.toBase58(), instPda: instPda ? instPda.toBase58() : null }
  }

  const accCoder = makeAccountsCoder(idl)
  try {
    const tableAcc = await fetchAndDecode<any>(connection, accCoder, tablePda, 'Table')
    const name = tableAcc ? toStr(tableAcc.name ?? tableAcc.table_name ?? tableName) : toStr(tableName)
    const columns = tableAcc ? (tableAcc.column_names ?? tableAcc.columns ?? []).map((v: any) => toStr(v)) : []
    // Try multiple key candidates for id/ext
    let idColumn: string | number | null | undefined = null
    let extTableName: string | null | undefined = null
    let extKeys: string[] = []

    const idRaw =
      tableAcc?.id_column ??
      tableAcc?.idColumn ??
      tableAcc?.id_index ??
      tableAcc?.idIndex ??
      null
    if (typeof idRaw === 'string') {
      idColumn = idRaw
    } else if (typeof idRaw === 'number') {
      idColumn = idRaw
    } else if (idRaw && typeof idRaw === 'object') {
      const s = toStr(idRaw)
      idColumn = s || null
    } else {
      idColumn = null
    }

    const extRaw = tableAcc?.ext_table_name ?? tableAcc?.extTableName ?? null
    extTableName = extRaw != null ? toStr(extRaw) : null

    const extKeysRaw = tableAcc?.ext_keys ?? tableAcc?.extKeys ?? []
    if (Array.isArray(extKeysRaw)) {
      extKeys = extKeysRaw.map((v: any) => toStr(v)).filter((s: string) => s.length > 0)
    }

    // default: if idColumn missing, fallback to first column name
    if ((idColumn == null || idColumn === '') && columns.length > 0) {
      idColumn = columns[0]
    }

    return { name, columns, idColumn, extTableName, extKeys, tablePda: tablePda.toBase58(), instPda: instPda ? instPda.toBase58() : null }
  } catch {
    return { name: toStr(tableName), columns: [], idColumn: null, extTableName: null, extKeys: [], tablePda: tablePda.toBase58(), instPda: instPda ? instPda.toBase58() : null }
  }
}
