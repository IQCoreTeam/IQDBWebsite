'use client'

import {useCallback, useEffect, useMemo, useState} from 'react'
import styled from 'styled-components'
import {
    AppBar,
    Toolbar,
    ScrollView,
    TextInput,
    Tabs,
    Tab,
    TabBody,
    GroupBox,
    Button,
    MenuList,
    MenuListItem,
    Table,
    TableHead,
    TableBody,
    TableRow,
    TableHeadCell,
    TableDataCell,
    ProgressBar,
    TreeView,
    Checkbox,
} from 'react95'
import {Connection, PublicKey} from '@solana/web3.js'
import WalletButton from '@/components/wallet/WalletButton'
import {useWallet} from '@solana/wallet-adapter-react'
import {useOnchainWriter} from '@/hooks/useOnchainWriter'
import {useOnchainReader} from '@/hooks/useOnchainReader'
import {useHybridV2Reader} from '@/hooks/useHybridV2Reader'
import {configs, pdaExtTable, pdaRoot, readRowsByTable, readTableMeta} from '@/lib/onchainDB'
import DraggableWindow from "@/components/ui/DraggableWindow";

const utf8Decoder = new TextDecoder()

const decodeVecOfBytesToStrings = (buffer: Uint8Array, start: number) => {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let offset = start

    if (offset + 4 > buffer.length) {
        return { values: [] as string[], offset }
    }

    const count = view.getUint32(offset, true)
    offset += 4
    const values: string[] = []

    for (let i = 0; i < count; i++) {
        if (offset + 4 > buffer.length) break
        const len = view.getUint32(offset, true)
        offset += 4
        if (offset + len > buffer.length) break
        const slice = buffer.subarray(offset, offset + len)
        offset += len
        const str = utf8Decoder.decode(slice).replace(/\0+$/, '').trim()
        if (str.length > 0) {
            values.push(str)
        }
    }

    return { values, offset }
}

const Container = styled.div`
    min-height: 100vh;
    background: #000000;
    padding: 20px;
    display: flex;
    flex-direction: column;
    box-shadow: inset 0 0 100px rgba(0, 255, 0, 0.1);
`


const ToolbarContent = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0 10px;
    gap: 20px;
`

const FieldRow = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
`


const Row = styled.div`
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
`


// Force dynamic rendering to avoid static generation issues
export const dynamic = 'force-dynamic'

export default function Home() {
    // SSR guard
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    // Wallet / Hooks MUST be called on every render to keep hook order stable
    const wallet = useWallet()
    const userPk = wallet.publicKey?.toBase58() || ''

    // Tabs state: 0 = write_data, 1 = read
    const [activeTab, setActiveTab] = useState<number>(0)

    // Writer state
    const {
        ready,
        loading: writing,
        error: writeError,
        lastSignature,
        loadIdl,
        initializeRoot,
        createTable,
        updateColumns,
        createExtTable,
        writeRow,
    } = useOnchainWriter({idlUrl: '/idl/iq_database.json'})

    // Writer inputs
    const [tableName, setTableName] = useState('')
    const [kvRows, setKvRows] = useState<Array<{ key: string; value: string }>>([{key: '', value: ''}])
    const [fetchingMeta, setFetchingMeta] = useState(false)

    // Write-tab: extension keys and popup states
    const [extKeysForWrite, setExtKeysForWrite] = useState<string[]>([])
    const [extTableNameForWrite, setExtTableNameForWrite] = useState<string>('')
    const [showWriteExtPopup, setShowWriteExtPopup] = useState(false)
    // selectedExtKey keeps the raw definition string for the clicked ext key
    const [selectedExtKey, setSelectedExtKey] = useState<string>('')
    const [extRowIdInput, setExtRowIdInput] = useState<string>('')
    const [extKvRows, setExtKvRows] = useState<Array<{ key: string; value: string }>>([])
    const [extTableReady, setExtTableReady] = useState<boolean>(false)
    const [extKeysByTable, setExtKeysByTable] = useState<Record<string, string[]>>({})
    const [extSingleByTable, setExtSingleByTable] = useState<Record<string, string>>({})

    // Parse ext key definition string like: {id:please,columns:{ hello1, hello2 }}
    const parseExtDef = (def: string): { id: string; columns: string[] } | null => {
      try {
        if (!def) return null
        const idMatch = def.match(/id\s*:\s*["']?([^,"'\s}]+)["']?/i)
        const colsMatch = def.match(/columns\s*:\s*\{([^}]+)\}/i)
        const id = idMatch?.[1]?.trim() || ''
        const columns = colsMatch
          ? colsMatch[1]
              .split(',')
              .map((c) => c.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean)
          : []
        if (!id) return null
        return { id, columns }
      } catch {
        return null
      }
    }

    const extractExtName = (def: string): string => {
      try {
        if (!def) return ''
        const trimmed = def.trim()
        if (!trimmed) return ''
        const braceIdx = trimmed.indexOf('{')
        const prefix = braceIdx >= 0 ? trimmed.slice(0, braceIdx) : trimmed
        const cleaned = prefix.replace(/["']/g, '').trim()
        if (!cleaned) return ''
        const withoutSuffix = cleaned.replace(/[:=]+\s*$/, '').trim()
        const target = withoutSuffix || cleaned
        const tokens = target.split(/\s+/).filter(Boolean)
        if (tokens.length === 0) return ''
        return tokens[tokens.length - 1]
      } catch {
        return ''
      }
    }

    const deriveExtKeyName = (def: string, fallback?: string): string => {
      const fromDef = extractExtName(def)
      if (fromDef) return fromDef
      if (fallback) {
        const cleaned = fallback.split('[')[0]?.trim()
        if (cleaned) return cleaned
      }
      const loose = def.split(/[{:]/)[0]?.trim()
      return loose || ''
    }

    const selectedExtMeta = useMemo(() => parseExtDef(selectedExtKey), [selectedExtKey])
    const selectedExtName = useMemo(() => extractExtName(selectedExtKey), [selectedExtKey])
    const [selectedExtKeyName, setSelectedExtKeyName] = useState<string>('')

    useEffect(() => {
      if (!selectedExtKey) {
        setSelectedExtKeyName('')
      }
    }, [selectedExtKey])

    const extNameForWrite = useMemo(() => {
      if (selectedExtName) return selectedExtName
      if (selectedExtKeyName) return selectedExtKeyName
      if (selectedExtKey) {
        const derived = deriveExtKeyName(selectedExtKey)
        if (derived) return derived
      }
      return extTableNameForWrite
    }, [selectedExtKey, selectedExtName, selectedExtKeyName, extTableNameForWrite])

    // Reader navigation states
    const [viewStep, setViewStep] = useState<'tables' | 'rows'>('tables')
    const [selectedTable, setSelectedTable] = useState<string | null>(null)
    const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
    const [rowsForSelected, setRowsForSelected] = useState<any[]>([])
    const [selectedTableColumns, setSelectedTableColumns] = useState<string[]>([])
    const [selectedTableExtKeys, setSelectedTableExtKeys] = useState<string[]>([])
    const [loadingRows, setLoadingRows] = useState<boolean>(false)

    // Tree view states (M5)
    const [treeSearch, setTreeSearch] = useState<string>('')
    const [rowsCache, setRowsCache] = useState<Record<string, any[]>>({})
    const [extRowsCache, setExtRowsCache] = useState<Record<string, { rows: any[]; idColumn: string | null }>>({})
    const [loadingTable, setLoadingTable] = useState<string | null>(null)
    const [selectedExt, setSelectedExt] = useState<{
        table: string;
        rowId: string | number;
        name: string;
        data: any[];
        path?: string;
    } | null>(null)
    const [selectedNode, setSelectedNode] = useState<string | null>(null)
    const [expandedNodes, setExpandedNodes] = useState<string[]>([])

    // AddFile popup state
    const [showAddFilePopup, setShowAddFilePopup] = useState(false)
    const [fileProgress, setFileProgress] = useState(0)

    // Manage Table popup state
    const [showManagePopup, setShowManagePopup] = useState(false)
    const [manageCols, setManageCols] = useState<string[]>([])
    const [manageFetching, setManageFetching] = useState(false)
    const [manageExisting, setManageExisting] = useState<boolean | null>(null)

    // Extension definitions state (stored as raw strings)
    const [manageExtDefs, setManageExtDefs] = useState<string[]>([])
    const [showAddExtPopup, setShowAddExtPopup] = useState(false)
    const [extDefInput, setExtDefInput] = useState<string>('')

    // Manage Table: selected ID column
    const [idColumnName, setIdColumnName] = useState<string>('')

    const getDerivedRowId = useCallback(() => {
      try {
        const idKey = (idColumnName || (kvRows[0]?.key || '')).trim()
        let found = kvRows.find((r) => r.key.trim() === idKey)
        let v = (found?.value ?? '').trim()
        if (!v && kvRows.length > 0) v = (kvRows[0].value || '').trim()
        if (v) {
          try {
            const parsedVal = JSON.parse(v)
            if (typeof parsedVal === 'string' || typeof parsedVal === 'number') {
              v = String(parsedVal)
            }
          } catch {
            // keep as-is
          }
        }
        return v.trim()
      } catch {
        return ''
      }
    }, [idColumnName, kvRows])

    const extRowIdForName = useMemo(() => {
      const direct = extRowIdInput.trim()
      if (direct) return direct
      const derived = getDerivedRowId()
      return derived
    }, [extRowIdInput, getDerivedRowId])

    const tableSegmentForName = useMemo(() => {
      const trimmed = tableName.trim()
      return trimmed || '(table)'
    }, [tableName])

    const extNameSegment = useMemo(() => {
      const trimmed = (extNameForWrite || '').trim()
      return trimmed || '(ext key)'
    }, [extNameForWrite])

    const nameFieldValue = `${tableSegmentForName}/${extRowIdForName || '(rowid)'}/${extNameSegment}`

    useEffect(() => {
      if (!showWriteExtPopup) return
      const derived = getDerivedRowId().trim()
      if (derived !== extRowIdInput) {
        setExtRowIdInput(derived)
      }
    }, [showWriteExtPopup, getDerivedRowId, extRowIdInput])

    // Extension builder UI
    const [extNameInput, setExtNameInput] = useState<string>('')
    const [extColsBuilder, setExtColsBuilder] = useState<string[]>([''])
    const [extIdName, setExtIdName] = useState<string>('')

    // HybridV2 reader for session PDAs
    const {loading: loadingHybrid, error: hybridError, data: hybridData, fetchSessionData} = useHybridV2Reader()
    const [showPreviewWindow, setShowPreviewWindow] = useState(false)
    const [hoveredByteRange, setHoveredByteRange] = useState<{ start: number; end: number } | null>(null)
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

    // Auto-load IDL when wallet connects
    useEffect(() => {
        if (wallet.connected) {
            loadIdl().catch(() => {
            })
        }
    }, [wallet.connected, loadIdl])

    const canUseWriter = useMemo(() => wallet.connected && ready, [wallet.connected, ready])

    // Reader
    const {data: readData, error: readError, loading: reading, idl: readerIdl, refresh} = useOnchainReader({
        userPublicKey: userPk,
        network: 'devnet',
        idlUrl: '/idl/iq_database.json',
        maxTx: 50,
        auto: wallet.connected, // auto fetch when connected
    })

    const fetchGlobalTableNames = useCallback(async () => {
        if (!userPk) {
            return [] as string[]
        }
        try {
            const endpoint = readData?.meta?.endpoint || configs.network
            const connection = new Connection(endpoint, 'confirmed')
            const rootPubkey = pdaRoot(new PublicKey(userPk))
            const accountInfo = await connection.getAccountInfo(rootPubkey)
            if (!accountInfo?.data) {
                return []
            }
            const raw = accountInfo.data instanceof Uint8Array ? accountInfo.data : new Uint8Array(accountInfo.data)
            let offset = 32 // skip creator pubkey
            const local = decodeVecOfBytesToStrings(raw, offset)
            const global = decodeVecOfBytesToStrings(raw, local.offset)
            return global.values
        } catch (err) {
            console.error('Failed to load root table names', err)
            return []
        }
    }, [userPk, readData?.meta?.endpoint])

    useEffect(() => {
        if (!showWriteExtPopup) return
        const baseTable = tableName.trim()
        const extSegment = (extNameForWrite || '').trim()
        const rowSegment = (extRowIdForName || '').trim()
        if (!baseTable || !extSegment || !rowSegment || !readerIdl || !userPk) {
            setExtTableReady(false)
            return
        }
        const extTableFullName = `${baseTable}/${rowSegment}/${extSegment}`
        const endpoint = readData?.meta?.endpoint || configs.network
        let cancelled = false
        ;(async () => {
            try {
                const connection = new Connection(endpoint, 'confirmed')
                const tableBytes = new TextEncoder().encode(extTableFullName)
                const signerPk = new PublicKey(userPk)
                const extPda = pdaExtTable(signerPk, tableBytes)
                const info = await connection.getAccountInfo(extPda)
                if (!cancelled) {
                    if (info) {
                        setExtTableReady(true)
                        return
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('Failed to check ext table PDA', err)
                }
            }
            try {
                const globals = await fetchGlobalTableNames()
                if (!cancelled) {
                    setExtTableReady(globals.includes(extTableFullName))
                }
            } catch {
                if (!cancelled) setExtTableReady(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [showWriteExtPopup, tableName, extNameForWrite, extRowIdForName, readerIdl, userPk, readData?.meta?.endpoint, fetchGlobalTableNames])

    // Auto refresh after successful write
    useEffect(() => {
        if (lastSignature) {
            refresh().catch(() => {
            })
        }
    }, [lastSignature, refresh])

    // Simulate progress while AddFile popup is open
    useEffect(() => {
        if (!showAddFilePopup) return
        setFileProgress(0)
        const timer = setInterval(() => {
            setFileProgress((p) => {
                const next = p + 7
                return next >= 100 ? 100 : next
            })
        }, 200)
        return () => clearInterval(timer)
    }, [showAddFilePopup])

    // Handlers
    // Tabs onChange follows React95 story signature (value: number, event)
    const onTabChange = (value: number) => setActiveTab(value)

    const onClickInit = async () => {
        await initializeRoot()
    }

    // Render guard should not prevent hooks from running; only hide UI
    if (!mounted) {
        return null
    }

    const onClickCreate = async () => {
        const cols = kvRows.map((r) => r.key.trim()).filter(Boolean)
        if (!tableName) return
        await createTable(tableName, cols)
    }

    const onClickWrite = async () => {
        if (!tableName) return
        const entries = kvRows
            .map(({key, value}) => ({key: key.trim(), value}))
            .filter((e) => e.key.length > 0)
        if (entries.length === 0) return

        const parseVal = (v: string) => {
            const t = v.trim()
            if (t.length === 0) return ''
            try {
                return JSON.parse(t)
            } catch {
                if (!Number.isNaN(Number(t)) && /^\d+(\.\d+)?$/.test(t)) return Number(t)
                if (/^(true|false)$/i.test(t)) return /^true$/i.test(t)
                return t
            }
        }

        const payload: Record<string, any> = {}
        for (const {key, value} of entries) {
            payload[key] = parseVal(value)
        }
        await writeRow(tableName, payload)
    }

    // Same normalization used in Details panel, enhanced to handle double-encoded and escaped cases:
    // - unquote once if the whole string is quoted (JSON.parse)
    // - de-escape \" -> "
    // - single quotes -> double quotes
    // - add quotes around unquoted keys: (\w+):
    // - try parse; if fail, remove trailing commas and try again; if still fail, fallback to first key/value extraction
    const normalizeFromValueString = (s: string): Record<string, any> | null => {
      if (!s) return null
      let text = s.trim()

      // Unquote once if the entire string is quoted (gives "apply normalization twice" effect on already-processed strings)
      if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        try {
          const unq = JSON.parse(text)
          if (typeof unq === 'string') text = unq.trim()
        } catch {
          // ignore
        }
      }

      // De-escape \" -> "
      text = text.replace(/\\"/g, '"')

      // 1) replace single quotes inside values
      text = text.replace(/'([^']*)'/g, '"$1"')
      // 2) quote unquoted keys (at start or after comma/brace)
      text = text.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      // 3) remove trailing commas before }
      text = text.replace(/,\s*}/g, '}')

      // First parse attempt
      try {
        return JSON.parse(text)
      } catch {
        // Try once more after reapplying key quoting (double-pass effect)
        let retry = text.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        try {
          return JSON.parse(retry)
        } catch {
          // Fallback: heuristic first key/value extraction
            const m = retry.match(/^\s*\{\s*"?([^"':,\s]+)"?\s*:\s*("?[^"{}]*"?'?[^,}]*)/)
          if (m && m[1] && m[2] != null) {
            const k = m[1]
            let vRaw = m[2].trim()
            if ((vRaw.startsWith('"') && vRaw.endsWith('"')) || (vRaw.startsWith("'") && vRaw.endsWith("'"))) {
              vRaw = vRaw.slice(1, -1)
            }
            return { [k]: vRaw }
          }
          return null
        }
      }
    }

    /**
     * getNormalizedValue
     * - Try to extract keyName from:
     *   1) direct row object
     *   2) row.raw -> JSON.parse -> outer.value (normalized like Details)
     *   3) row.value (normalized like Details)
     *   4) row string (normalized like Details)
     * - If keyName is missing, return the first value.
     */
    const getNormalizedValue = (row: any, keyName?: string): string | number | null => {
      try {
        // 0) If row is a plain string, normalize and extract
        if (typeof row === 'string') {
          const obj = normalizeFromValueString(row)
          if (obj) {
            if (keyName && Object.prototype.hasOwnProperty.call(obj, keyName) && (obj as any)[keyName] != null) {
              return (obj as any)[keyName]
            }
            const entries = Object.entries(obj)
            if (entries.length > 0) return entries[0][1] as any
          }
          return row
        }

        // 1) Direct row object
        if (row && typeof row === 'object') {
          if (keyName && Object.prototype.hasOwnProperty.call(row, keyName) && (row as any)[keyName] != null) {
            return (row as any)[keyName]
          }

          // 2) row.raw -> JSON.parse -> outer.value -> normalize
          if (typeof (row as any).raw === 'string') {
            try {
              const outer = JSON.parse((row as any).raw)
              const valStr = typeof outer?.value === 'string' ? outer.value : ''
              if (valStr) {
                const obj = normalizeFromValueString(valStr)
                if (obj) {
                  if (keyName && Object.prototype.hasOwnProperty.call(obj, keyName) && (obj as any)[keyName] != null) {
                    return (obj as any)[keyName]
                  }
                  const entries = Object.entries(obj)
                  if (entries.length > 0) return entries[0][1] as any
                }
              }
            } catch {
              // ignore
            }
          }

          // 3) row.value -> normalize
          if (typeof (row as any).value === 'string') {
            const obj = normalizeFromValueString((row as any).value)
            if (obj) {
              if (keyName && Object.prototype.hasOwnProperty.call(obj, keyName) && (obj as any)[keyName] != null) {
                return (obj as any)[keyName]
              }
              const entries = Object.entries(obj)
              if (entries.length > 0) return entries[0][1] as any
            }
          }

          // 4) Fallback: first entry from row object itself
          const entries = Object.entries(row as any)
          if (entries.length > 0) return entries[0][1] as any
        }
      } catch {
        // ignore
      }
      return null
    }

    const parseRowToRecord = (row: any): Record<string, any> => {
      try {
        if (row == null) return {}
        if (typeof row === 'string') {
          const normalized = normalizeFromValueString(row)
          return normalized || { value: row }
        }
        if (typeof row === 'object') {
          if (typeof (row as any).raw === 'string') {
            try {
              const outer = JSON.parse((row as any).raw)
              const valStr = typeof outer?.value === 'string' ? outer.value : ''
              if (valStr) {
                const parsed = normalizeFromValueString(valStr)
                if (parsed) return parsed
              }
            } catch {
              // ignore
            }
          }
          if (typeof (row as any).value === 'string') {
            const parsed = normalizeFromValueString((row as any).value)
            if (parsed) return parsed
          }
          const copy: Record<string, any> = { ...row }
          if ('raw' in copy) delete copy.raw
          return copy
        }
        return { value: row }
      } catch {
        return {}
      }
    }

    const formatCellValue = (val: any): string => {
      if (val == null) return ''
      if (typeof val === 'object') {
        try {
          return JSON.stringify(val)
        } catch {
          return String(val)
        }
      }
      return String(val)
    }

    return (
        <Container>
            {/* App bar */}
            <AppBar>
                <Toolbar>
                    <ToolbarContent>
                        IQ Labs DB
                        <WalletButton/>
                    </ToolbarContent>
                </Toolbar>
            </AppBar>

            {/* Main window with tabs */}
            <div style={{marginTop: 16, display: 'flex', justifyContent: 'center'}}>
                <DraggableWindow title="[ iqdb_console.exe ]" width={1024}>
                    <Tabs value={activeTab} onChange={onTabChange}>
                        <Tab value={0}>write_data</Tab>
                        <Tab value={1}>read_data</Tab>
                    </Tabs>

                    <TabBody>

                        {activeTab === 0 && (
                            <div>
                                <GroupBox label="Write row">
                                  {/* Right-top ext keys scroller */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                    <div style={{ flex: 1 }}>
                                      <FieldRow>
                                        <p style={{minWidth: 100}}>Table name</p>
                                        <TextInput
                                            placeholder="table name"
                                            value={tableName}
                                            onChange={(e) => setTableName(e.target.value)}
                                        />
                                        <Button
                                            size="sm"
                                            title="Fetch columns by table name"
                                            disabled={!readerIdl || !userPk || !tableName || fetchingMeta}
                                            onClick={async () => {
                                                if (!readerIdl || !userPk || !tableName) return
                                                setFetchingMeta(true)
                                                try {
                                                    const globalTables = await fetchGlobalTableNames()
                                                    const trimmedTableName = tableName.trim()
                                                    const knownInRoot = trimmedTableName.length > 0 && globalTables.includes(trimmedTableName)
                                                    const endpoint = readData?.meta?.endpoint
                                                    // Fetch meta + rows together
                                                    const [meta, rows] = await Promise.all([
                                                      readTableMeta({
                                                        userPublicKey: userPk,
                                                        idl: readerIdl,
                                                        endpoint,
                                                        programId: (readerIdl as any).address,
                                                        tableName,
                                                      }),
                                                      readRowsByTable({
                                                        userPublicKey: userPk,
                                                        idl: readerIdl,
                                                        endpoint,
                                                        programId: (readerIdl as any).address,
                                                        tableName,
                                                        maxTx: 100,
                                                        perTableLimit: 500,
                                                      }),
                                                    ])

                                                    // Set ext keys for right-top scroller
                                                    const extKeys = ((meta as any)?.extKeys || (meta as any)?.ext_keys || []) as any[]
                                                    const extAsStrings = Array.isArray(extKeys) ? extKeys.map((x) => String(x)) : []
                                                    setExtKeysForWrite(extAsStrings)
                                                    setExtTableNameForWrite(String((meta as any)?.extTableName || (meta as any)?.ext_table_name || ''))

                                                    // Log full meta + rows to browser console
                                                    console.log('[IQDB] meta for', tableName, meta)
                                                    console.log('[IQDB] rows for', tableName, rows)

                                                    const cols: string[] = (meta?.columns || []).map((c) => String(c).trim()).filter(Boolean)
                                                    if (cols.length === 0 && !knownInRoot) return

                                                    // Update KV inputs from columns
                                                    setKvRows((prev) => {
                                                        const existing = new Set(prev.map((p) => p.key.trim()).filter(Boolean))
                                                        const missing = cols.filter((c) => !existing.has(c))
                                                        if (prev.length === 1 && prev[0].key.trim() === '' && prev[0].value.trim() === '') {
                                                            return missing.map((c) => ({key: c, value: ''}))
                                                        }
                                                        return [...prev, ...missing.map((c) => ({key: c, value: ''}))]
                                                    })

                                                } finally {
                                                    setFetchingMeta(false)
                                                }
                                            }}
                                        >
                                            {fetchingMeta ? 'Fetching...' : 'Fetch'}
                                        </Button>
                                    </FieldRow>
                                    </div>

                                    {/* Right side: small vertical scroller with ext keys */}
                                    <div style={{ width: 220 }}>
                                      <p style={{ margin: '0 0 6px 0' }}>Ext keys</p>
                                      <ScrollView style={{ height: 110, padding: 6 }}>
                                        {extKeysForWrite.length === 0 ? (
                                          <div style={{ color: '#888', fontSize: 12 }}>none</div>
                                        ) : (
                                          extKeysForWrite.map((def, i) => {
                                            const parsed = parseExtDef(def)
                                            const label = parsed ? `${parsed.id} [${parsed.columns.join(', ')}]` : def
                                            return (
                                              <Button
                                                key={`${def}-${i}`}
                                                size="sm"
                                                style={{ width: '100%', marginBottom: 6, justifyContent: 'flex-start' }}
                                                onClick={() => {
                                                  const derivedRowId = getDerivedRowId()
                                                  const trimmedRowId = derivedRowId.trim()
                                                  if (!trimmedRowId) {
                                                    alert('Please fill the id field')
                                                    return
                                                  }
                                                  setSelectedExtKey(def)
                                                  setSelectedExtKeyName(deriveExtKeyName(def, label))
                                                  setExtTableReady(false)
                                                  if (parsed) {
                                                    const uniqueColumns = Array.from(new Set([parsed.id, ...parsed.columns]))
                                                    setExtKvRows(uniqueColumns.map((c) => ({
                                                      key: c,
                                                      value: ''
                                                    })))
                                                  } else {
                                                    setExtKvRows([])
                                                  }
                                                  setExtRowIdInput(trimmedRowId)
                                                  setShowWriteExtPopup(true)
                                                }}
                                                title={def}
                                              >
                                                {label}
                                              </Button>
                                            )
                                          })
                                        )}
                                      </ScrollView>
                                    </div>
                                  </div>

                                    <div style={{marginTop: 8}}>
                                        <p>Data</p>
                                        <Table>
                                            <TableHead>
                                                <TableRow>
                                                    <TableHeadCell style={{width: 180}}>Column</TableHeadCell>
                                                    <TableHeadCell>Data</TableHeadCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {kvRows.map((pair, idx) => (
                                                    <TableRow key={idx}>
                                                        <TableDataCell>
                                                            <TextInput
                                                                placeholder="column (use Fetch or Manage Table)"
                                                                value={pair.key}
                                                                readOnly
                                                                disabled
                                                            />
                                                        </TableDataCell>
                                                        <TableDataCell>
                                                            <TextInput
                                                                placeholder="value"
                                                                value={pair.value}
                                                                onChange={(e) => {
                                                                    const v = e.target.value
                                                                    setKvRows((rows) => {
                                                                        const next = rows.slice()
                                                                        next[idx] = {...next[idx], value: v}
                                                                        return next
                                                                    })
                                                                }}
                                                            />
                                                        </TableDataCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                        <div style={{marginTop: 8, display: 'flex', gap: 8}}>
                                            <Button
                                                size="sm"
                                                onClick={() => setKvRows((rows) => [...rows, {key: '', value: ''}])}
                                            >
                                                + Add
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={() => setShowAddFilePopup(true)}
                                                title="add file by codein"
                                            >
                                                + AddFile
                                            </Button>
                                        </div>
                                    </div>

                                    <Row>
                                        <Button onClick={onClickInit} disabled={!wallet.connected || writing}>
                                            Initialize Root
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                setManageCols([])
                                                setManageExisting(null)
                                                setShowManagePopup(true)
                                            }}
                                            disabled={!canUseWriter || writing}
                                        >
                                            Manage Table
                                        </Button>
                                        <Button onClick={onClickWrite} disabled={!canUseWriter || writing}>
                                            Write Row
                                        </Button>
                                    </Row>

                                    <div style={{marginTop: 8}}>
                                        {writeError ? <p style={{color: '#ff5555'}}>⚠ {writeError}</p> : null}
                                        {lastSignature ? <p>Sig: {lastSignature.slice(0, 30) + "..."}</p> : null}
                                        {!wallet.connected ? <p>Connect your wallet to enable writer.</p> : null}
                                        {wallet.connected && !ready ? <p>Loading IDL...</p> : null}
                                    </div>
                                </GroupBox>
                            </div>
                        )}

                        {activeTab === 1 && (
                            <div>
                                <GroupBox label="Read data">
                                    <Row>
                                        <Button
                                            onClick={async () => {
                                                await refresh()
                                                setViewStep('tables')
                                                setSelectedTable(null)
                                                setSelectedRowIndex(null)
                                                setRowsForSelected([])
                                                setSelectedTableColumns([])
                                                // reset tree view caches/selections
                                                setTreeSearch('')
                                                setRowsCache({})
                                                setExtRowsCache({})
                                                setLoadingTable(null)
                                                setSelectedExt(null)
                                            }}
                                            disabled={!wallet.connected || reading}
                                        >
                                            Refresh
                                        </Button>
                                    </Row>
                                    <div style={{marginTop: 8}}>
                                        {readError ? (
                                            <p style={{color: '#ff5555'}}>⚠ {readError}</p>
                                        ) : null}
                                        {!wallet.connected ? <p>Connect your wallet to read data.</p> : null}
                                    </div>

                                    <div style={{display: 'flex', gap: 12, marginTop: 12, minHeight: 280}}>

                                        {/* Left pane: Tree view (tables -> rows -> ext) */}
                                        <div style={{
                                            flex: 1,
                                            minWidth: 260,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            minHeight: 0
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: 8
                                            }}>
                                                <p style={{margin: 0}}>Tables</p>
                                                <TextInput
                                                    placeholder="search table..."
                                                    value={treeSearch}
                                                    onChange={(e) => setTreeSearch(e.target.value)}
                                                    style={{minWidth: 160}}
                                                />
                                            </div>

                                            <div style={{marginTop: 8, height: 280}}>
                                                {reading && !readData ? (
                                                    <p>Loading...</p>
                                                ) : (readData?.tableNames?.length || 0) === 0 ? (
                                                    <p>No tables found.</p>
                                                ) : (
                                                    (() => {
                                                        const names = (readData!.tableNames || []).filter((t) =>
                                                            treeSearch ? t.toLowerCase().includes(treeSearch.trim().toLowerCase()) : true
                                                        )

                                                        const tree = names.map((t) => {
                                                            const meta = (readData as any)?.tables?.[t]
                                                            const idCol = (() => {
                                                                if (!meta) return 'id'
                                                                if (typeof meta.idColumn === 'string') return meta.idColumn
                                                                if (typeof meta.idColumn === 'number' && meta.columns?.[meta.idColumn]) return meta.columns[meta.idColumn]
                                                                return meta.columns?.[0] || 'id'
                                                            })()

                                                            const rows = rowsCache[t]
                                                            const extDefsRaw = extKeysByTable[t] ?? ((meta?.extKeys || meta?.ext_keys) ?? []).map((x: any) => String(x))
                                                            const singleExt = extSingleByTable[t] ?? (meta?.extTableName || meta?.ext_table_name || '').toString().trim()
                                                            const extChildrenFactory = (idx: number, rowIdLabel: string | number) => {
                                                              const nodes: Array<{ id: string; label: string; items?: any[] }> = []
                                                              const rowIdStr = String(rowIdLabel)
                                                              if (Array.isArray(extDefsRaw) && extDefsRaw.length > 0) {
                                                                extDefsRaw.forEach((raw: any) => {
                                                                  const rawStr = String(raw)
                                                                  const extKey = deriveExtKeyName(rawStr) || rawStr
                                                                  const displayLabel = `${t}/${rowIdStr}/${extKey}`
                                                                  const nodeId = `ext:${t}:${idx}:key:${encodeURIComponent(rawStr)}:${encodeURIComponent(extKey)}:${encodeURIComponent(displayLabel)}`
                                                                  const extCacheKey = displayLabel
                                                                  const cached = extRowsCache[extCacheKey]
                                                                  const parsedDef = parseExtDef(rawStr)
                                                                  const idColumnHint = cached?.idColumn || parsedDef?.id || 'id'
                                                                  const childItems = cached && cached.rows.length > 0
                                                                    ? cached.rows.map((extRow, extIdx) => {
                                                                        const labelValue = getNormalizedValue(extRow, idColumnHint || undefined) ?? extIdx
                                                                        const label = String(labelValue)
                                                                        return {
                                                                          id: `extrow:${encodeURIComponent(extCacheKey)}:${extIdx}:${encodeURIComponent(label)}`,
                                                                          label,
                                                                        }
                                                                      })
                                                                    : undefined
                                                                  nodes.push({ id: nodeId, label: displayLabel, items: childItems })
                                                                })
                                                              }
                                                              if (singleExt) {
                                                                const displayLabel = `${t}/${rowIdStr}/${singleExt}`
                                                                const nodeId = `ext:${t}:${idx}:single::${encodeURIComponent(singleExt)}:${encodeURIComponent(displayLabel)}`
                                                                const extCacheKey = displayLabel
                                                                const cached = extRowsCache[extCacheKey]
                                                                const idColumnHint = cached?.idColumn || 'id'
                                                                const childItems = cached && cached.rows.length > 0
                                                                  ? cached.rows.map((extRow, extIdx) => {
                                                                      const labelValue = getNormalizedValue(extRow, idColumnHint || undefined) ?? extIdx
                                                                      const label = String(labelValue)
                                                                      return {
                                                                        id: `extrow:${encodeURIComponent(extCacheKey)}:${extIdx}:${encodeURIComponent(label)}`,
                                                                        label,
                                                                      }
                                                                    })
                                                                  : undefined
                                                                nodes.push({ id: nodeId, label: displayLabel, items: childItems })
                                                              }
                                                              return nodes.length > 0 ? nodes : undefined
                                                            }

                                                            const rowItems = rows
                                                                ? rows.map((r, idx) => {
                                                                  // Normalize label using the same logic as Details panel
                                                                  const normalized = getNormalizedValue(r, idCol)
                                                                  const rowId = normalized != null ? normalized : idx
                                                                  return {
                                                                    id: `row:${t}:${idx}`,
                                                                    label: String(rowId),
                                                                    items: extChildrenFactory(idx, normalized != null ? normalized : idx),
                                                                  }
                                                                })
                                                                : undefined

                                                            const isLoadingThisTable = loadingTable === t
                                                            return {
                                                                id: `table:${t}`,
                                                                label: isLoadingThisTable ? `${t} [Loading]` : t,
                                                                items: rowItems,
                                                            }
                                                        })

                                                        return (

                                                            <ScrollView style={{height: 270, minHeight: 0}}>
                                                                <div style={{height: '100%', overflow: 'auto'}}>
                                                                    <TreeView
                                                                        tree={tree as any}
                                                                        onNodeSelect={async (_e, id) => {
                                                                            setSelectedNode(id)
                                                                            const parts = String(id).split(':')
                                                                            const kind = parts[0]

                                                                            if (kind === 'table') {
                                                                                const table = parts[1]
                                                                                if (!readerIdl || !userPk || !table) return
                                                                                if (!rowsCache[table]) {
                                                                                    setLoadingTable(table)
                                                                                    setSelectedExt(null)
                                                                                    try {
                                                                                        const endpoint = readData?.meta?.endpoint
                                                                                        const [tableRows, metaResp] = await Promise.all([
                                                                                            readRowsByTable({
                                                                                                userPublicKey: userPk,
                                                                                                idl: readerIdl,
                                                                                                endpoint,
                                                                                                programId: (readerIdl as any).address,
                                                                                                tableName: table,
                                                                                                maxTx: 100,
                                                                                            }),
                                                                                            readTableMeta({
                                                                                                userPublicKey: userPk,
                                                                                                idl: readerIdl,
                                                                                                endpoint,
                                                                                                programId: (readerIdl as any).address,
                                                                                                tableName: table,
                                                                                            }),
                                                                                        ])
                                                                                        setRowsCache((prev) => ({
                                                                                            ...prev,
                                                                                            [table]: tableRows
                                                                                        }))
                                                                                        setSelectedTable(table)
                                                                                        setRowsForSelected(tableRows)
                                                                                        const cols: string[] =
                                                                                            (metaResp?.columns?.length ?? 0) > 0
                                                                                                ? metaResp!.columns
                                                                                                : tableRows && tableRows[0] && typeof tableRows[0] === 'object'
                                                                                                    ? Object.keys(tableRows[0] as any)
                                                                                                    : []
                                                                                        setSelectedTableColumns(cols)
                                                                                          // Capture ext keys if present in meta
                                                                                          const metaExtKeys = ((metaResp as any)?.extKeys || (metaResp as any)?.ext_keys || []) as any[]
                                                                                            const extKeyDefs = Array.isArray(metaExtKeys) ? metaExtKeys.map((x: any) => String(x)) : []
                                                                                            setExtKeysByTable((prev) => {
                                                                                              const next = { ...prev }
                                                                                              if (extKeyDefs.length > 0) {
                                                                                                next[table] = extKeyDefs
                                                                                              } else {
                                                                                                delete next[table]
                                                                                              }
                                                                                              return next
                                                                                            })
                                                                                            const singleExtNameRaw = (metaResp as any)?.extTableName || (metaResp as any)?.ext_table_name
                                                                                            const singleExtName = singleExtNameRaw ? String(singleExtNameRaw).trim() : ''
                                                                                            setExtSingleByTable((prev) => {
                                                                                              const next = { ...prev }
                                                                                              if (singleExtName) {
                                                                                                next[table] = singleExtName
                                                                                              } else {
                                                                                                delete next[table]
                                                                                              }
                                                                                              return next
                                                                                            })
                                                                                            const extKeyLabels = extKeyDefs.map((raw) => deriveExtKeyName(raw) || raw)
                                                                                            const combinedExtLabels = singleExtName ? [...extKeyLabels, singleExtName] : extKeyLabels
                                                                                            setSelectedTableExtKeys(Array.from(new Set(combinedExtLabels)))
                                                                                            console.log(`[IQDB] Rows for ${table}:`, tableRows)
                                                                                        setViewStep('rows')
                                                                                        setExpandedNodes((prev) =>
                                                                                            prev.includes(id as string) ? prev : [...prev, id as string]
                                                                                        )
                                                                                    } finally {
                                                                                        setLoadingTable(null)
                                                                                    }
                                                                                } else {
                                                                                    setSelectedTable(table)
                                                                                    setRowsForSelected(rowsCache[table])
                                                                                    setSelectedRowIndex(null)
                                                                                    setSelectedExt(null)

                                                                                  // Also capture ext keys from stored meta so the Ext keys button can render
                                                                                  try {
                                                                                    const metaInStore = (readData as any)?.tables?.[table]
                                                                                    const ek = ((metaInStore?.extKeys || metaInStore?.ext_keys) ?? []) as any[]
                                                                                    const extKeyDefs = Array.isArray(ek) ? ek.map((x: any) => String(x)) : []
                                                                                    setExtKeysByTable((prev) => {
                                                                                      const next = { ...prev }
                                                                                      if (extKeyDefs.length > 0) {
                                                                                        next[table] = extKeyDefs
                                                                                      } else {
                                                                                        delete next[table]
                                                                                      }
                                                                                      return next
                                                                                    })
                                                                                    const singleExtNameRaw = (metaInStore as any)?.extTableName || (metaInStore as any)?.ext_table_name
                                                                                    const singleExtName = singleExtNameRaw ? String(singleExtNameRaw).trim() : ''
                                                                                    setExtSingleByTable((prev) => {
                                                                                      const next = { ...prev }
                                                                                      if (singleExtName) {
                                                                                        next[table] = singleExtName
                                                                                      } else {
                                                                                        delete next[table]
                                                                                      }
                                                                                      return next
                                                                                    })
                                                                                    const extKeyLabels = extKeyDefs.map((raw) => deriveExtKeyName(raw) || raw)
                                                                                    const combinedExtLabels = singleExtName ? [...extKeyLabels, singleExtName] : extKeyLabels
                                                                                    setSelectedTableExtKeys(Array.from(new Set(combinedExtLabels)))
                                                                                    console.log(`[IQDB] Rows for ${table} (cached):`, rowsCache[table])
                                                                                  } catch {
                                                                                    setSelectedTableExtKeys([])
                                                                                    console.log(`[IQDB] Rows for ${table} (cached):`, rowsCache[table])
                                                                                  }

                                                                                    setViewStep('rows')
                                                                                    setExpandedNodes((prev) =>
                                                                                        prev.includes(id as string) ? prev : [...prev, id as string]
                                                                                    )
                                                                                }
                                                                            } else if (kind === 'row') {
                                                                                const table = parts[1]
                                                                                const idx = Number(parts[2])
                                                                                setSelectedExt(null)
                                                                                setSelectedTable(table)
                                                                                setSelectedRowIndex(Number.isFinite(idx) ? idx : null)
                                                                                setViewStep('rows')
                                                                                const rowNodeId = `row:${table}:${idx}`
                                                                                setExpandedNodes((prev) => prev.includes(rowNodeId) ? prev : [...prev, rowNodeId])
                                                                            } else if (kind === 'ext') {
                                                                                const table = parts[1]
                                                                                const idx = Number(parts[2])
                                                                                const mode = parts[3] || ''
                                                                                const rawDefEncoded = parts.length > 4 ? parts[4] : ''
                                                                                const extKeyEncoded = parts.length > 5 ? parts[5] : ''
                                                                                const displayLabelEncoded = parts.length > 6 ? parts[6] : ''
                                                                                const rawDef = decodeURIComponent(rawDefEncoded)
                                                                                const extKeyFromNode = decodeURIComponent(extKeyEncoded)
                                                                                const displayLabel = decodeURIComponent(displayLabelEncoded)
                                                                                if (!readerIdl || !userPk || !table || !Number.isFinite(idx)) return
                                                                                const rows = rowsCache[table] || []
                                                                                const meta = (readData as any)?.tables?.[table]
                                                                                const idCol = (() => {
                                                                                    if (!meta) return 'id'
                                                                                    if (typeof meta.idColumn === 'string') return meta.idColumn
                                                                                    if (typeof meta.idColumn === 'number' && meta.columns?.[meta.idColumn]) return meta.columns[meta.idColumn]
                                                                                    return meta.columns?.[0] || 'id'
                                                                                })()
                                                                                const row = rows[idx]
                                                                                const normalizedForPath = getNormalizedValue(row, idCol)
                                                                                const rowId = normalizedForPath != null ? normalizedForPath : idx
                                                                                const extDefsList = extKeysByTable[table] ?? ((meta?.extKeys || meta?.ext_keys) ?? []).map((x: any) => String(x))
                                                                                const singleExtName = extSingleByTable[table] ?? (meta?.extTableName || meta?.ext_table_name || '').toString().trim()
                                                                                let effectiveExtName = (extKeyFromNode || '').trim()
                                                                                if (!effectiveExtName && displayLabel) {
                                                                                  const fromDisplay = displayLabel.split('/').pop()?.trim()
                                                                                  if (fromDisplay) effectiveExtName = fromDisplay
                                                                                }
                                                                                if (!effectiveExtName) {
                                                                                  if (mode === 'key') {
                                                                                    effectiveExtName = deriveExtKeyName(rawDef) || rawDef || (extDefsList[0] ? deriveExtKeyName(String(extDefsList[0])) || String(extDefsList[0]) : 'extension')
                                                                                  } else if (mode === 'single') {
                                                                                    effectiveExtName = singleExtName || rawDef || 'extension'
                                                                                  } else {
                                                                                    effectiveExtName = rawDef || (extDefsList[0] ? deriveExtKeyName(String(extDefsList[0])) || String(extDefsList[0]) : 'extension')
                                                                                  }
                                                                                }
                                                                                const rowIdStr = String(rowId)
                                                                                const extTableFullName = `${table}/${rowIdStr}/${effectiveExtName}`
                                                                                try {
                                                                                    const endpoint = readData?.meta?.endpoint
                                                                                    const [extRows, extMeta] = await Promise.all([
                                                                                        readRowsByTable({
                                                                                            userPublicKey: userPk,
                                                                                            idl: readerIdl,
                                                                                            endpoint,
                                                                                            programId: (readerIdl as any).address,
                                                                                            tableName: extTableFullName,
                                                                                            maxTx: 50,
                                                                                            perTableLimit: 50,
                                                                                        }),
                                                                                        (async () => {
                                                                                            try {
                                                                                                return await readTableMeta({
                                                                                                    userPublicKey: userPk,
                                                                                                    idl: readerIdl,
                                                                                                    endpoint,
                                                                                                    programId: (readerIdl as any).address,
                                                                                                    tableName: extTableFullName,
                                                                                                })
                                                                                            } catch {
                                                                                                return null
                                                                                            }
                                                                                        })(),
                                                                                    ])
                                                                                    const normalizedRows = Array.isArray(extRows) ? extRows : []
                                                                                    const idColumnFromMeta = (() => {
                                                                                        if (!extMeta) return null
                                                                                        const metaId = (extMeta as any)?.idColumn
                                                                                        if (typeof metaId === 'string') return metaId
                                                                                        if (typeof metaId === 'number') {
                                                                                            const colsArr = Array.isArray(extMeta?.columns) ? extMeta?.columns : []
                                                                                            if (colsArr && colsArr[metaId]) return String(colsArr[metaId])
                                                                                        }
                                                                                        if (Array.isArray(extMeta?.columns) && extMeta.columns[0]) {
                                                                                            return String(extMeta.columns[0])
                                                                                        }
                                                                                        return null
                                                                                    })()
                                                                                    const parsedDef = parseExtDef(rawDef)
                                                                                    const fallbackIdColumn = parsedDef?.id || 'id'
                                                                                    const idColumnName = idColumnFromMeta || fallbackIdColumn
                                                                                    setExtRowsCache((prev) => ({
                                                                                        ...prev,
                                                                                        [extTableFullName]: { rows: normalizedRows, idColumn: idColumnName || null },
                                                                                    }))
                                                                                    setSelectedExt({
                                                                                        table,
                                                                                        rowId,
                                                                                        name: effectiveExtName,
                                                                                        path: displayLabel || extTableFullName,
                                                                                        data: normalizedRows.length > 0
                                                                                            ? normalizedRows
                                                                                            : [{ message: `${effectiveExtName} is not added for this row.` }]
                                                                                    })
                                                                                    setExpandedNodes((prev) =>
                                                                                        prev.includes(id as string) ? prev : [...prev, id as string]
                                                                                    )
                                                                                } catch (e: any) {
                                                                                    console.error('read ext table failed', e)
                                                                                    const fallbackName = effectiveExtName || deriveExtKeyName(rawDef) || singleExtName || 'extension'
                                                                                    const parsedDef = parseExtDef(rawDef)
                                                                                    const fallbackIdColumn = parsedDef?.id || 'id'
                                                                                    setExtRowsCache((prev) => ({
                                                                                        ...prev,
                                                                                        [extTableFullName]: prev[extTableFullName] ?? { rows: [], idColumn: fallbackIdColumn },
                                                                                    }))
                                                                                    setSelectedExt({
                                                                                        table,
                                                                                        rowId,
                                                                                        name: fallbackName,
                                                                                        path: displayLabel || `${table}/${rowIdStr}/${fallbackName}`,
                                                                                        data: [{ message: `${fallbackName} is not added for this row.` }]
                                                                                    })
                                                                                }
                                                                            } else if (kind === 'extrow') {
                                                                                const encodedPath = parts[1] || ''
                                                                                const extPath = decodeURIComponent(encodedPath)
                                                                                const extRowIdx = Number(parts[2])
                                                                                const labelEncoded = parts.length > 3 ? parts[3] : ''
                                                                                const label = labelEncoded ? decodeURIComponent(labelEncoded) : ''
                                                                                const cacheEntry = extRowsCache[extPath]
                                                                                if (!cacheEntry) return
                                                                                const rows = Array.isArray(cacheEntry.rows) ? cacheEntry.rows : []
                                                                                const pickedRow = Number.isFinite(extRowIdx) && extRowIdx >= 0 && extRowIdx < rows.length ? rows[extRowIdx] : null
                                                                                const pathParts = extPath.split('/')
                                                                                const baseTable = pathParts[0] || ''
                                                                                const baseRowId = pathParts[1] || ''
                                                                                const extNameSegment = pathParts.slice(2).join('/') || 'extension'
                                                                                const idColumnName = cacheEntry.idColumn || 'id'
                                                                                const displayRows = pickedRow ? [pickedRow] : rows
                                                                                setSelectedExt({
                                                                                    table: baseTable,
                                                                                    rowId: label || baseRowId || extRowIdx,
                                                                                    name: extNameSegment,
                                                                                    path: extPath,
                                                                                    data: displayRows.length > 0
                                                                                        ? displayRows
                                                                                        : [{ message: `${extNameSegment} is not added for this row.` }]
                                                                                })
                                                                            }
                                                                        }}
                                                                        onNodeToggle={(_e, ids) => setExpandedNodes(ids)}
                                                                        expanded={expandedNodes}
                                                                        selected={selectedNode || undefined}
                                                                    />
                                                                </div>
                                                            </ScrollView>
                                                        )
                                                    })()
                                                )}
                                            </div>
                                        </div>

                                        {/* Right pane: details of selected row / ext with columns meta */}
                                        <div style={{flex: 1.2, minWidth: 320}}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between'
                                            }}>
                                                <p style={{margin: 0}}>Details</p>
                                                {selectedTable ? (
                                                    <div style={{
                                                        display: 'flex',
                                                        gap: 6,
                                                        alignItems: 'center',
                                                        flexWrap: 'wrap'
                                                    }}>
                                                        <p>columns:</p>
                                                        {selectedTableColumns.length > 0 ? (
                                                            selectedTableColumns.map((c: string, i: number) => (
                                                                <span
                                                                    key={`${c}-${i}`}
                                                                    style={{padding: '2px 6px'}}
                                                                >
                                  {c}
                                </span>
                                                            ))
                                                        ) : (
                                                            <p>none</p>
                                                        )}
                                      {/* If ext keys exist, show a button to alert them */}
                                      {selectedTableExtKeys.length > 0 ? (
                                        <p style={{ margin: '6px 0 0 0', fontSize: 12, color: '#00ff00' }}>
                                          Ext keys: {selectedTableExtKeys.join(', ')}
                                        </p>
                                      ) : null}
                                                    </div>
                                                ) : null}
                                            </div>

                                            <ScrollView
                                                style={{marginTop: 8, height: 280, paddingRight: 6}}>
                                                <div style={{height: '100%', overflow: 'auto'}}>
                                                    {/* EXT selection preview */}
                                                    {selectedExt ? (
                                                        <div style={{
                                                            marginBottom: 12,
                                                            padding: 8,
                                                            background: '#001100',
                                                            border: '1px solid #00ff00'
                                                        }}>
                                                            <p style={{marginTop: 0, color: '#00ff00'}}>
                                                                {selectedExt.path || `${selectedExt.table} / ${String(selectedExt.rowId)} / ${selectedExt.name}`}
                                                            </p>
                                                            {(() => {
                                                              const dataArray = Array.isArray(selectedExt.data) ? selectedExt.data : []
                                                              if (dataArray.length === 0) {
                                                                return (
                                                                  <p style={{ margin: 0, color: '#00ff00', fontSize: 11 }}>
                                                                    No extension rows loaded.
                                                                  </p>
                                                                )
                                                              }

                                                              const parsedRows = dataArray.map((row) => parseRowToRecord(row))
                                                              const dataRows = parsedRows.filter((row) =>
                                                                Object.keys(row).some((key) => key !== 'message' && key !== 'raw')
                                                              )
                                                              const messageRows = parsedRows.filter(
                                                                (row) => 'message' in row && Object.keys(row).length === 1
                                                              )

                                                              if (dataRows.length === 0) {
                                                                const message = messageRows[0]?.message ?? 'Extension rows not found.'
                                                                return (
                                                                  <p style={{ margin: 0, color: '#00ff00', fontSize: 11 }}>
                                                                    {String(message)}
                                                                  </p>
                                                                )
                                                              }

                                                              const columns = Array.from(
                                                                new Set(
                                                                  dataRows.flatMap((row) =>
                                                                    Object.keys(row).filter((key) => key !== 'raw')
                                                                  )
                                                                )
                                                              )

                                                              if (columns.length === 0) {
                                                                const message = messageRows[0]?.message ?? 'Extension rows not found.'
                                                                return (
                                                                  <p style={{ margin: 0, color: '#00ff00', fontSize: 11 }}>
                                                                    {String(message)}
                                                                  </p>
                                                                )
                                                              }

                                                              return (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                                  {dataRows.map((row, rowIdx) => (
                                                                    <div key={`ext-row-${rowIdx}`}>
                                                                      {dataRows.length > 1 && (
                                                                        <p style={{ margin: '0 0 4px 0', color: '#00ff00', fontSize: 11 }}>
                                                                          Row {rowIdx + 1}
                                                                        </p>
                                                                      )}
                                                                      <Table>
                                                                        <TableHead>
                                                                          <TableRow>
                                                                            <TableHeadCell>Column</TableHeadCell>
                                                                            <TableHeadCell>Value</TableHeadCell>
                                                                          </TableRow>
                                                                        </TableHead>
                                                                        <TableBody>
                                                                          {columns.map((col) => (
                                                                            <TableRow key={`ext-row-${rowIdx}-${col}`}>
                                                                              <TableDataCell>{col}</TableDataCell>
                                                                              <TableDataCell>
                                                                                {formatCellValue(
                                                                                  Object.prototype.hasOwnProperty.call(row, col)
                                                                                    ? (row as any)[col]
                                                                                    : ''
                                                                                )}
                                                                              </TableDataCell>
                                                                            </TableRow>
                                                                          ))}
                                                                        </TableBody>
                                                                      </Table>
                                                                    </div>
                                                                  ))}
                                                                  {messageRows.length > 0 && (
                                                                    <p style={{ margin: 0, color: '#00ff00', fontSize: 11 }}>
                                                                      {String(messageRows[0].message ?? '')}
                                                                    </p>
                                                                  )}
                                                                </div>
                                                              )
                                                            })()}
                                                        </div>
                                                    ) : null}

                                                    {selectedTable != null && selectedRowIndex != null ? (
                                                        (() => {
                                                            const cols: string[] =
                                                                (selectedTableColumns && selectedTableColumns.length > 0
                                                                    ? selectedTableColumns
                                                                    : (((readData as any)?.tables?.[selectedTable]?.columns as string[]) || []))
                                                            const row: any = rowsForSelected[selectedRowIndex] ?? {}
                                                            // row.raw -> outer.value (loose JSON-like) -> parse into object
                                                            const decoded: Record<string, any> = (() => {
                                                                try {
                                                                    if (row && typeof row === 'object' && typeof row.raw === 'string') {
                                                                        try {
                                                                            const outer = JSON.parse(row.raw)
                                                                            let valStr: string = typeof outer?.value === 'string' ? outer.value : ''
                                                                            if (valStr) {
                                                                                // Normalize quotes and unquoted keys to valid JSON before parsing
                                                                                let normalized = valStr.trim()
                                                                                normalized = normalized.replace(/'([^']*)'/g, '"$1"').replace(/(\w+)\s*:/g, '"$1":')
                                                                                return JSON.parse(normalized)
                                                                            }
                                                                        } catch {
                                                                            // ignore; fall through
                                                                        }
                                                                    }
                                                                    return row && typeof row === 'object' ? row : {}
                                                                } catch {
                                                                    return {}
                                                                }
                                                            })()

                                                            const clickable = new Set(['session_pda', 'sessionPda', 'dbLinkedListTrx', 'db_linked_list_trx', 'tail_tx', 'tailTx'])

                                                            return (
                                                                <>
                                                                    {cols.length > 0 ? (
                                                                        <ScrollView>
                                                                            <div style={{width: "max-content"}}>
                                                                                <Table>
                                                                                    <TableHead>
                                                                                        <TableRow>
                                                                                            <TableHeadCell>Column</TableHeadCell>
                                                                                            <TableHeadCell>Value</TableHeadCell>
                                                                                        </TableRow>
                                                                                    </TableHead>
                                                                                    <TableBody>
                                                                                        {cols.map((col) => {
                                                                                            const val =
                                                                                                decoded?.[col] ??
                                                                                                (row && typeof row === 'object' ? (row as any)[col] : undefined) ??
                                                                                                ''
                                                                                            const isClickable = clickable.has(col)
                                                                                            const isSessionPda = col === 'session_pda' || col === 'sessionPda'
                                                                                            return (
                                                                                                <TableRow key={col}>
                                                                                                    <TableDataCell>{col}</TableDataCell>
                                                                                                    <TableDataCell>
                                                                                                        {isClickable ? (
                                                                                                            <Button
                                                                                                                disabled={loadingHybrid}
                                                                                                                onClick={async () => {
                                                                                                                    if (isSessionPda) {
                                                                                                                        const rpcUrl = process.env.NEXT_PUBLIC_HYBRID_RPC || 'https://rpc.zeroblock.io'
                                                                                                                        try {
                                                                                                                            await fetchSessionData(String(val), rpcUrl)
                                                                                                                        } catch (e) {
                                                                                                                            console.error('Failed to fetch session data:', e)
                                                                                                                        }
                                                                                                                    } else {
                                                                                                                        alert(String(val ?? ''))
                                                                                                                    }
                                                                                                                }}
                                                                                                                title={String(val ?? '')}
                                                                                                            >
                                                                                                                {loadingHybrid && isSessionPda ? 'loading ' : ''}
                                                                                                                {String(val ?? '')}
                                                                                                            </Button>
                                                                                                        ) : (
                                                                                                            <div
                                                                                                                title={String(val ?? '')}>
                                                                                                                {String(val ?? '')}
                                                                                                            </div>
                                                                                                        )}
                                                                                                    </TableDataCell>
                                                                                                </TableRow>
                                                                                            )
                                                                                        })}
                                                                                    </TableBody>
                                                                                </Table>
                                                                            </div>
                                                                        </ScrollView>
                                                                    ) : (
                                                                        <p>No columns metadata.</p>
                                                                    )}

                                                                    {/* Display HybridV2 data if loaded */}
                                                                    {hybridData && (
                                                                        <div style={{
                                                                            marginTop: 12,
                                                                            padding: 8,
                                                                            background: '#001100',
                                                                            border: '1px solid #00ff00',
                                                                            maxWidth: '100%',
                                                                            overflow: 'hidden'
                                                                        }}>
                                                                            <p style={{
                                                                                color: '#00ff00',
                                                                                marginBottom: 8,
                                                                                fontSize: 12
                                                                            }}> Session Data:</p>
                                                                            <div style={{marginTop: 8, fontSize: 11}}>
                                                                                <div>Status: {hybridData.metadata.status}</div>
                                                                                <div>Chunks: {hybridData.chunksFound}/{hybridData.totalChunks}</div>
                                                                                <div>Type: {hybridData.fileType?.toUpperCase() || 'UNKNOWN'}</div>
                                                                                <div>Size: {(hybridData.decompressedData || hybridData.reconstructedData).length} bytes</div>
                                                                            </div>
                                                                            <div style={{
                                                                                display: 'flex',
                                                                                gap: 8,
                                                                                marginTop: 12
                                                                            }}>
                                                                                <Button
                                                                                    size="sm"
                                                                                    onClick={() => setShowPreviewWindow(true)}
                                                                                >
                                                                                    Preview
                                                                                </Button>
                                                                                <Button
                                                                                    size="sm"
                                                                                    onClick={() => {
                                                                                        const data = hybridData.decompressedData || hybridData.reconstructedData
                                                                                        const blob = new Blob([new Uint8Array(data)])
                                                                                        const url = URL.createObjectURL(blob)
                                                                                        const a = document.createElement('a')
                                                                                        a.href = url
                                                                                        a.download = `session_${hybridData.metadata.sessionId.slice(0, 8)}.${hybridData.fileType || 'bin'}`
                                                                                        document.body.appendChild(a)
                                                                                        a.click()
                                                                                        document.body.removeChild(a)
                                                                                        URL.revokeObjectURL(url)
                                                                                    }}
                                                                                >
                                                                                    Download
                                                                                </Button>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {hybridError && (
                                                                        <p style={{
                                                                            color: '#ff5555',
                                                                            marginTop: 8,
                                                                            fontSize: 12
                                                                        }}>⚠ {hybridError}</p>
                                                                    )}
                                                                </>
                                                            )
                                                        })()
                                                    ) : (
                                                        <p>Select a row from the left.</p>
                                                    )}
                                                </div>
                                            </ScrollView>
                                        </div>
                                    </div>
                                </GroupBox>
                            </div>
                        )}
                    </TabBody>
                </DraggableWindow>
            </div>

            {/* Add File Popup Window */}
            {showAddFilePopup && (
                <DraggableWindow
                    title="[ add_file.exe ]"
                    initialPosition={{x: 220, y: 140}}
                    onClose={() => setShowAddFilePopup(false)}
                    width={420}
                    zIndex={20000}
                >
                    <div style={{padding: 16}}>
                        <GroupBox label="add file by codein">
                            <p>
                                Preparing... Check progress below.
                            </p>
                            {/* Progress bar */}
                            <ProgressBar variant="tile" value={Math.floor(fileProgress)}/>
                            <div style={{marginTop: 6, textAlign: 'right', fontSize: 12, color: '#0f0'}}>
                                {fileProgress}%
                            </div>

                            <div style={{display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end'}}>
                                <Button
                                    onClick={() => {
                                        // Fill existing session_pda if present; otherwise append one
                                        setKvRows((rows) => {
                                            const idx = rows.findIndex(r => r.key.trim() === 'session_pda' || r.key.trim() === 'sessionPda')
                                            if (idx >= 0) {
                                                const next = rows.slice()
                                                next[idx] = {...next[idx], value: 'examplesessionpda'}
                                                return next
                                            }
                                            return [...rows, {key: 'session_pda', value: 'examplesessionpda'}]
                                        })
                                        setShowAddFilePopup(false)
                                    }}
                                >
                                    Done
                                </Button>
                                <Button onClick={() => setShowAddFilePopup(false)}>Cancel</Button>
                            </div>
                        </GroupBox>
                    </div>
                </DraggableWindow>
            )}

            {/* Manage Table Popup */}
            {showManagePopup && (
                <DraggableWindow
                    title="[ manage_table.exe ]"
                    initialPosition={{x: 240, y: 120}}
                    onClose={() => setShowManagePopup(false)}
                    width={560}
                    zIndex={20000}
                >
                    <div style={{padding: 16}}>
                        <GroupBox label="Manage table">
                            <FieldRow>
                                <p style={{minWidth: 100, margin: 0}}>Table name</p>
                                <TextInput
                                    placeholder="table name"
                                    value={tableName}
                                    onChange={(e) => setTableName(e.target.value)}
                                />
                                <Button
                                    size="sm"
                                    disabled={!readerIdl || !userPk || !tableName || manageFetching}
                                    onClick={async () => {
                                        if (!readerIdl || !userPk || !tableName) return
                                        setManageFetching(true)
                                        try {
                                            const globalTables = await fetchGlobalTableNames()
                                            const trimmedName = tableName.trim()
                                            const knownInRoot = trimmedName.length > 0 && globalTables.includes(trimmedName)
                                            const endpoint = readData?.meta?.endpoint
                                            const meta = await readTableMeta({
                                                userPublicKey: userPk,
                                                idl: readerIdl,
                                                endpoint,
                                                programId: (readerIdl as any).address,
                                                tableName,
                                            })

                                            const cols = (meta?.columns || []).map((c: any) => String(c).trim()).filter(Boolean)
                                            setManageExisting(cols.length > 0 || knownInRoot)
                                            setManageCols(cols.length > 0 ? cols : [])
                                            // Resolve id column name
                                            const metaId = (meta as any)?.idColumn
                                            if (typeof metaId === 'string') {
                                              setIdColumnName(metaId)
                                            } else if (typeof metaId === 'number' && cols[metaId]) {
                                              setIdColumnName(cols[metaId])
                                            } else if (cols[0]) {
                                              setIdColumnName(cols[0])
                                            } else {
                                              setIdColumnName('')
                                            }

                                            const extKeys = ((meta as any)?.extKeys || (meta as any)?.ext_keys || []) as any[]
                                            const extAsStrings = Array.isArray(extKeys) ? extKeys.map((x) => String(x)) : []
                                            setManageExtDefs(extAsStrings)
                                        } finally {
                                            setManageFetching(false)
                                        }
                                    }}
                                >
                                    {manageFetching ? 'Fetching...' : 'Fetch'}
                                </Button>
                            </FieldRow>

                            <div style={{marginTop: 12}}>
                                <p style={{marginBottom: 6}}>
                                    {manageExisting == null
                                        ? 'Enter table name and fetch to manage columns.'
                                        : manageExisting
                                            ? 'Existing columns (you can add or edit):'
                                            : 'No existing table. Define columns to create.'}
                                </p>
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableHeadCell style={{width: 220}}>Column</TableHeadCell>
                                      <TableHeadCell style={{width: 80}}>ID?</TableHeadCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {manageCols.map((c, idx) => (
                                      <TableRow key={idx}>
                                        <TableDataCell>
                                          <TextInput
                                            placeholder="column name"
                                            value={c}
                                            onChange={(e) => {
                                              const v = e.target.value
                                              setManageCols((prev) => {
                                                const next = prev.slice()
                                                const prevName = next[idx]
                                                next[idx] = v
                                                // Keep id selection consistent when editing a name
                                                if (idColumnName === prevName) {
                                                  setIdColumnName(v)
                                                }
                                                return next
                                              })
                                            }}
                                          />
                                        </TableDataCell>
                                        <TableDataCell>
                                          <Checkbox
                                            checked={idColumnName === c}
                                            onChange={() => setIdColumnName(c)}
                                            label=""
                                          />
                                        </TableDataCell>
                                      </TableRow>
                                    ))}
                                    {manageCols.length === 0 && (
                                      <TableRow>
                                        <TableDataCell>
                                          <TextInput
                                            placeholder="column name"
                                            value=""
                                            onChange={(e) => {
                                              const v = e.target.value
                                              if (v.trim().length > 0) {
                                                setManageCols([v])
                                                setIdColumnName(v)
                                              }
                                            }}
                                          />
                                        </TableDataCell>
                                        <TableDataCell>
                                          <Checkbox checked={true} onChange={() => {}} label="" />
                                                </TableDataCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                                <div style={{marginTop: 8, display: 'flex', gap: 8}}>
                                    <Button
                                        size="sm"
                                        onClick={() => setManageCols((prev) => [...prev, ''])}
                                    >
                                        + Add column
                                    </Button>
                                </div>
                            </div>

                            {/* Extensions section */}
                            <div style={{ marginTop: 16 }}>
                              <p style={{ marginBottom: 6 }}>Extensions</p>
                              <Table>
                                <TableHead>
                                  <TableRow>
                                    <TableHeadCell>Definition (raw string)</TableHeadCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {manageExtDefs.length > 0 ? (
                                    manageExtDefs.map((def, idx) => (
                                      <TableRow key={`extdef-${idx}`}>
                                        <TableDataCell>
                                          <TextInput value={def} readOnly disabled />
                                        </TableDataCell>
                                      </TableRow>
                                    ))
                                  ) : (
                                    <TableRow>
                                      <TableDataCell>
                                        <div style={{ color: '#888' }}>
                                          No extensions defined. Click "Add extension" to add one, e.g. {'{id:name,columns:{data1,data2}}'}
                                        </div>
                                      </TableDataCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                              <div style={{ marginTop: 8 }}>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setExtDefInput('')
                                    setExtNameInput('')
                                    setExtColsBuilder([''])
                                    setExtIdName('')
                                    setShowAddExtPopup(true)
                                  }}
                                >
                                  + Add extension
                                </Button>
                              </div>
                            </div>

                            <div style={{display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end'}}>
                                {manageExisting ? (
                                    <Button
                                        onClick={async () => {
                                            if (!tableName) return
                                            const cols = manageCols.map((s) => s.trim()).filter(Boolean)
                                            if (cols.length === 0) return
                                            if (!idColumnName || !cols.includes(idColumnName)) {
                                              alert('Select a valid ID column')
                                              return
                                            }
                                            try {
                                              await updateColumns(
                                                tableName,
                                                cols,
                                                { idColumn: idColumnName, extKeys: manageExtDefs }
                                              )
                                              setShowManagePopup(false)
                                              await refresh()
                                            } catch {
                                              // ignore, error handled by hook
                                            }
                                        }}
                                        disabled={!canUseWriter || writing}
                                    >
                                        Update columns
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={async () => {
                                            if (!tableName) return
                                            const cols = manageCols.map((s) => s.trim()).filter(Boolean)
                                            if (cols.length === 0) return
                                            if (!idColumnName || !cols.includes(idColumnName)) {
                                              alert('Select a valid ID column')
                                              return
                                            }
                                            try {
                                              await createTable(
                                                tableName,
                                                cols,
                                                { idColumn: idColumnName, extKeys: manageExtDefs }
                                              )
                                              setShowManagePopup(false)
                                              await refresh()
                                            } catch {
                                              // ignore
                                            }
                                        }}
                                        disabled={!canUseWriter || writing}
                                    >
                                        Create table
                                    </Button>
                                )}
                                <Button onClick={() => setShowManagePopup(false)}>Close</Button>
                            </div>
                        </GroupBox>
                    </div>
                </DraggableWindow>
            )}

            {/* Write Extension Popup */}
            {showWriteExtPopup && (
              <DraggableWindow
                title="[ write_ext.exe ]"
                initialPosition={{ x: 300, y: 140 }}
                onClose={() => {
                  setExtTableReady(false)
                  setSelectedExtKey('')
                  setShowWriteExtPopup(false)
                }}
                width={620}
                zIndex={21000}
              >
                <div style={{ padding: 16 }}>
                  <GroupBox label="Write extension row">
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <p style={{ minWidth: 120, margin: 0 }}>Name</p>
                        <TextInput value={nameFieldValue} readOnly disabled />
                      </div>
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableHeadCell style={{ width: 220 }}>Column</TableHeadCell>
                            <TableHeadCell>Value</TableHeadCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {extKvRows.length > 0 ? (
                            extKvRows.map((pair, idx) => {
                              const isIdColumn = pair.key === (selectedExtMeta?.id || '')
                              return (
                                <TableRow key={`extkv-${idx}`}>
                                  <TableDataCell>
                                    <TextInput value={pair.key} readOnly disabled />
                                  </TableDataCell>
                                  <TableDataCell>
                                    <TextInput
                                      placeholder={isIdColumn ? 'id value (required)' : 'value'}
                                      value={pair.value}
                                      onChange={(e) => {
                                        const v = e.target.value
                                        setExtKvRows((rows) => {
                                          const next = rows.slice()
                                          next[idx] = { ...next[idx], value: v }
                                          return next
                                        })
                                      }}
                                    />
                                  </TableDataCell>
                                </TableRow>
                              )
                            })
                          ) : (
                            <TableRow>
                              <TableDataCell>
                                <div style={{ color: '#888' }}>No extension columns parsed.</div>
                              </TableDataCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                      <Button
                        onClick={async () => {
                          const parsed = selectedExtMeta
                          if (!parsed) {
                            alert('Invalid extension definition (missing id)')
                            return
                          }

                          const trimmedTableName = tableName.trim()
                          if (!trimmedTableName) {
                            alert('Table name is required')
                            return
                          }

                          const extensionNameSegment = extNameForWrite.trim()
                          if (!extensionNameSegment || extensionNameSegment === '(ext key)') {
                            alert('Select a valid extension key')
                            return
                          }

                          let rowId = extRowIdForName.trim()
                          if (!rowId) {
                            rowId = getDerivedRowId()
                          }
                          if (!rowId) {
                            alert('Please fill the id field')
                            return
                          }
                          if (extRowIdInput.trim() !== rowId) {
                            setExtRowIdInput(rowId)
                          }

                          const extTableFullName = `${trimmedTableName}/${rowId}/${extensionNameSegment}`

                          if (!extTableReady) {
                            const columns = parsed.columns.length > 0
                              ? Array.from(new Set([parsed.id, ...parsed.columns]))
                              : [parsed.id]
                            if (columns.length === 0) {
                              alert('Extension definition has no columns')
                              return
                            }
                            try {
                              const sig = await createExtTable(extTableFullName, columns, { idColumn: parsed.id, extKeys: [] })
                              if (sig) {
                                if (sig === 'already-exists') {
                                  alert(`${extTableFullName} already exists. You can write rows now.`)
                                } else {
                                  alert(`Created extension table ${extTableFullName}\nSig: ${sig}`)
                                }
                                setExtTableReady(true)
                              }
                            } catch (e) {
                              // error already handled by hook
                            }
                            return
                          }

                          const normalizeValue = (raw: string) => {
                            const t = raw.trim()
                            if (t.length === 0) return ''
                            try {
                              return JSON.parse(t)
                            } catch {
                              // continue to heuristic checks
                            }
                            if (!Number.isNaN(Number(t)) && /^\d+(\.\d+)?$/.test(t)) return Number(t)
                            if (/^(true|false)$/i.test(t)) return /^true$/i.test(t)
                            return raw
                          }

                          const payload: Record<string, any> = {}
                          const idKey = parsed.id
                          let hasIdValue = false
                          for (const { key, value } of extKvRows) {
                            if (!key) continue
                            const normalized = normalizeValue(value)
                            payload[key] = normalized
                            if (key === idKey && value.trim().length > 0) {
                              hasIdValue = true
                            }
                          }
                          if (!hasIdValue) {
                            alert(`Please fill the "${idKey}" value before writing this extension row.`)
                            return
                          }

                          try {
                            const sig = await writeRow(extTableFullName, payload)
                            if (sig) {
                              alert(`Saved extension row to ${extTableFullName}\nSig: ${sig}`)
                            } else {
                              alert(`Failed to save extension row to ${extTableFullName}`)
                            }
                            setExtTableReady(false)
                            setSelectedExtKey('')
                            setShowWriteExtPopup(false)
                          } catch (e: any) {
                            console.error('write ext row failed', e)
                            alert(e?.message || 'write ext row failed')
                          }
                        }}
                        disabled={!canUseWriter || writing}
                      >
                        {extTableReady ? 'Write row' : 'Create ext table'}
                      </Button>
                      <Button onClick={() => {
                        setExtTableReady(false)
                        setSelectedExtKey('')
                        setShowWriteExtPopup(false)
                      }}>Cancel</Button>
                    </div>
                  </GroupBox>
                </div>
              </DraggableWindow>
            )}

            {/* Add Extension Popup */}
            {showAddExtPopup && (
              <DraggableWindow
                title="[ add_ext.exe ]"
                initialPosition={{ x: 280, y: 160 }}
                onClose={() => setShowAddExtPopup(false)}
                width={560}
                zIndex={20000}
              >
                <div style={{ padding: 16 }}>
                  <GroupBox label="Add extension">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <p style={{ minWidth: 110, margin: 0 }}>Ext name</p>
                      <TextInput
                        placeholder="e.g. expiration_date"
                        value={extNameInput}
                        onChange={(e) => setExtNameInput(e.target.value)}
                      />
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <p style={{ marginBottom: 6 }}>Columns</p>
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableHeadCell style={{ width: 240 }}>Column</TableHeadCell>
                            <TableHeadCell style={{ width: 80 }}>ID?</TableHeadCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {extColsBuilder.map((c, idx) => (
                            <TableRow key={`extcol-${idx}`}>
                              <TableDataCell>
                                <TextInput
                                  placeholder="column name"
                                  value={c}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setExtColsBuilder((prev) => {
                                      const next = prev.slice()
                                      const prevName = next[idx]
                                      next[idx] = v
                                      if (extIdName === prevName) setExtIdName(v)
                                      return next
                                    })
                                  }}
                                />
                              </TableDataCell>
                              <TableDataCell>
                                <Checkbox
                                  checked={extIdName === c}
                                  onChange={() => setExtIdName(c)}
                                  label=""
                                />
                              </TableDataCell>
                            </TableRow>
                          ))}
                          {extColsBuilder.length === 0 && (
                            <TableRow>
                              <TableDataCell>
                                <TextInput
                                  placeholder="column name"
                                  value=""
                                  onChange={(e) => {
                                    const v = e.target.value
                                    if (v.trim()) {
                                      setExtColsBuilder([v])
                                      setExtIdName(v)
                                    }
                                  }}
                                />
                              </TableDataCell>
                              <TableDataCell>
                                <Checkbox checked={true} onChange={() => {}} label="" />
                              </TableDataCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                      <div style={{ marginTop: 8 }}>
                        <Button
                          size="sm"
                          onClick={() => setExtColsBuilder((prev) => [...prev, ''])}
                        >
                          + Add column
                        </Button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                      <Button
                        onClick={async () => {
                          const extName = (extNameInput || '').trim()
                          const cols = extColsBuilder.map((s) => s.trim()).filter(Boolean)
                          if (!extName) {
                            alert('Enter extension name')
                            return
                          }
                          if (cols.length === 0) {
                            alert('Add at least one extension column')
                            return
                          }
                          if (!extIdName || !cols.includes(extIdName)) {
                            alert('Select a valid extension ID column')
                            return
                          }

                          // Compose definition string including ext name prefix for easier parsing
                          const defStr = `${extName}:{id:${extIdName},columns:{ ${cols.join(',')} }}`

                          try {
                            if (!readerIdl || !userPk || !tableName) {
                              alert('Missing wallet/IDL/tableName')
                              return
                            }
                            const endpoint = readData?.meta?.endpoint
                            // Reload latest meta
                            const meta = await readTableMeta({
                              userPublicKey: userPk,
                              idl: readerIdl,
                              endpoint,
                              programId: (readerIdl as any).address,
                              tableName,
                            })
                            const baseCols = (meta?.columns || []).map((c) => String(c))
                            const extKeysPrev = ((meta as any)?.extKeys || (meta as any)?.ext_keys || []) as any[]
                            const extAsStrings = Array.isArray(extKeysPrev) ? extKeysPrev.map((x) => String(x)) : []
                            const extKeysNext = [...extAsStrings, defStr]

                            // Determine base table id column best-effort
                            let baseId: string | number | undefined = (meta as any)?.idColumn
                            if (typeof baseId === 'number' && baseCols[baseId]) baseId = baseCols[baseId]

                            // Persist: update columns with extTableName + extKeys
                            await updateColumns(
                              tableName,
                              baseCols,
                              { idColumn: baseId as any, extKeys: extKeysNext }
                            )

                            setManageExtDefs(extKeysNext)
                            setExtKeysByTable((prev) => ({ ...prev, [tableName]: extKeysNext }))
                            setExtSingleByTable((prev) => ({ ...prev, [tableName]: extName.trim() }))
                            setSelectedTableExtKeys(extKeysNext.map((raw) => deriveExtKeyName(raw) || raw))
                            setShowAddExtPopup(false)
                          } catch (e) {
                            console.error('Failed to save extension:', e)
                            alert('Failed to save extension')
                          }
                        }}
                      >
                        Save
                      </Button>
                      <Button onClick={() => setShowAddExtPopup(false)}>Cancel</Button>
                    </div>
                  </GroupBox>
                </div>
              </DraggableWindow>
            )}

            {/* File Preview Popup Window */}
            {showPreviewWindow && hybridData && (
                <DraggableWindow
                    title={`[ preview ]`}
                    initialPosition={{x: 150, y: 100}}
                    onClose={() => setShowPreviewWindow(false)}
                    width={1100}
                    zIndex={20000}
                >
                    <div style={{padding: 16, background: '#000', minHeight: 500, display: 'flex', gap: 16}}>
                        {(() => {
                            const data = hybridData.decompressedData || hybridData.reconstructedData
                            const uint8Data = new Uint8Array(data)

                            // Enhanced magic byte detection
                            const detectFileType = (): string => {
                                if (uint8Data.length < 4) return 'bin'

                                // WEBP: RIFF....WEBP
                                if (uint8Data[0] === 0x52 && uint8Data[1] === 0x49 && uint8Data[2] === 0x46 && uint8Data[3] === 0x46) {
                                    if (uint8Data.length >= 12 && uint8Data[8] === 0x57 && uint8Data[9] === 0x45 && uint8Data[10] === 0x42 && uint8Data[11] === 0x50) {
                                        return 'webp'
                                    }
                                }

                                // PNG: 89 50 4E 47
                                if (uint8Data[0] === 0x89 && uint8Data[1] === 0x50 && uint8Data[2] === 0x4E && uint8Data[3] === 0x47) return 'png'

                                // JPEG: FF D8 FF
                                if (uint8Data[0] === 0xFF && uint8Data[1] === 0xD8 && uint8Data[2] === 0xFF) return 'jpg'

                                // GIF: 47 49 46
                                if (uint8Data[0] === 0x47 && uint8Data[1] === 0x49 && uint8Data[2] === 0x46) return 'gif'

                                // BMP: 42 4D
                                if (uint8Data[0] === 0x42 && uint8Data[1] === 0x4D) return 'bmp'

                                // MP4: ....ftyp
                                if (uint8Data.length >= 12 && uint8Data[4] === 0x66 && uint8Data[5] === 0x74 && uint8Data[6] === 0x79 && uint8Data[7] === 0x70) return 'mp4'

                                // PDF: 25 50 44 46
                                if (uint8Data[0] === 0x25 && uint8Data[1] === 0x50 && uint8Data[2] === 0x44 && uint8Data[3] === 0x46) return 'pdf'

                                return hybridData.fileType || 'bin'
                            }

                            const detectedType = detectFileType()
                            console.log('[PREVIEW] Detected:', detectedType, 'Bytes:', Array.from(uint8Data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '))

                            // Hex dump (left side) with highlighting
                            const hexDump = (
                                <ScrollView style={{
                                    flex: 1,
                                    minWidth: 350,
                                    maxHeight: 500,
                                    background: '#001100',
                                    padding: 12,
                                    border: '1px solid #00ff00'
                                }}>
                                    <div style={{
                                        color: '#00ff00',
                                        marginBottom: 8,
                                        fontSize: 12,
                                        fontWeight: 'bold'
                                    }}>Magic Bytes ({detectedType.toUpperCase()}):
                                    </div>
                                    <pre style={{
                                        margin: 0,
                                        color: '#00ff00',
                                        fontSize: 11,
                                        fontFamily: 'monospace',
                                        background: '#002200',
                                        padding: 8
                                    }}>
                    {Array.from(uint8Data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}
                  </pre>
                                    <div style={{color: '#888', marginTop: 16, marginBottom: 8, fontSize: 11}}>
                                        Hex
                                        Dump: {hoveredByteRange && `(bytes ${hoveredByteRange.start}-${hoveredByteRange.end})`}
                                    </div>
                                    <pre style={{margin: 0, fontSize: 9, fontFamily: 'monospace', lineHeight: 1.6}}>
                    {Array.from(uint8Data.slice(0, 2048))
                        .map((b: number, i: number) => {
                            const hex = b.toString(16).padStart(2, '0')
                            const offset = i % 16 === 0 ? `${i.toString(16).padStart(4, '0')}: ` : ''
                            const isHighlighted = hoveredByteRange && i >= hoveredByteRange.start && i <= hoveredByteRange.end
                            const color = isHighlighted ? '#00ff00' : '#888'
                            const bgColor = isHighlighted ? '#003300' : 'transparent'
                            const fontWeight = isHighlighted ? 'bold' : 'normal'
                            const textShadow = isHighlighted ? '0 0 8px #00ff00' : 'none'

                            return (
                                <span key={i} style={{color, backgroundColor: bgColor, fontWeight, textShadow}}>
                            {i % 16 === 0 ? '\n' : ''}{offset}{hex}{' '}
                          </span>
                            )
                        })}
                                        {uint8Data.length > 2048 ? '\n...' : ''}
                  </pre>
                                </ScrollView>
                            )

                            // File preview (right side)
                            let preview = null

                            // Images (including WEBP) with interactive hover
                            if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(detectedType)) {
                                const blob = new Blob([uint8Data], {type: `image/${detectedType}`})
                                const url = URL.createObjectURL(blob)
                                preview = (
                                    <img
                                        src={url}
                                        alt="Preview"
                                        style={{
                                            maxWidth: '100%',
                                            maxHeight: '500px',
                                            objectFit: 'contain',
                                            cursor: 'crosshair'
                                        }}
                                        onLoad={(e) => {
                                            const img = e.target as HTMLImageElement
                                            setImageSize({width: img.naturalWidth, height: img.naturalHeight})
                                        }}
                                        onMouseMove={(e) => {
                                            if (!imageSize) return
                                            const rect = e.currentTarget.getBoundingClientRect()
                                            const y = ((e.clientY - rect.top) / rect.height) // 0.0 at top to 1.0 at bottom

                                            // Map vertical position directly to byte range (0-2048 for display)
                                            // This is approximate since compressed formats don't map directly
                                            const byteOffset = Math.floor(y * 2016) // Leave room for 32-byte highlight at bottom

                                            setHoveredByteRange({
                                                start: Math.max(0, byteOffset),
                                                end: Math.min(2047, byteOffset + 32) // Show 32 bytes
                                            })
                                        }}
                                        onMouseLeave={() => setHoveredByteRange(null)}
                                    />
                                )
                            }

                            // Videos
                            else if (['mp4', 'webm', 'mov', 'avi'].includes(detectedType)) {
                                const blob = new Blob([uint8Data], {type: `video/${detectedType === 'mov' ? 'quicktime' : detectedType}`})
                                const url = URL.createObjectURL(blob)
                                preview = (
                                    <video controls style={{maxWidth: '100%', maxHeight: '500px'}}>
                                        <source src={url}
                                                type={`video/${detectedType === 'mov' ? 'quicktime' : detectedType}`}/>
                                    </video>
                                )
                            }

                            // PDF
                            else if (detectedType === 'pdf') {
                                const blob = new Blob([uint8Data], {type: 'application/pdf'})
                                const url = URL.createObjectURL(blob)
                                preview = <iframe src={url} style={{width: '100%', height: '500px', border: 'none'}}/>
                            }

                            // Text
                            else if (hybridData.preview || detectedType === 'txt' || detectedType === 'json') {
                                preview = (
                                    <ScrollView style={{width: '100%', maxHeight: '500px', padding: 12}}>
                    <pre style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        color: '#00ff00',
                        fontSize: 11,
                        fontFamily: 'monospace'
                    }}>
                      {hybridData.preview || data.toString('utf8')}
                    </pre>
                                    </ScrollView>
                                )
                            }

                            // Unknown - just show message
                            else {
                                preview = (
                                    <div style={{width: '100%', padding: 40, textAlign: 'center', color: '#888'}}>
                                        <div style={{fontSize: 14, marginBottom: 8}}>Unknown file type</div>
                                        <div style={{fontSize: 11}}>Size: {uint8Data.length} bytes</div>
                                        <div style={{fontSize: 10, marginTop: 16}}>Check hex dump for details</div>
                                    </div>
                                )
                            }

                            return (
                                <>
                                    {hexDump}
                                    <ScrollView style={{
                                        flex: 2,
                                        minWidth: 500,
                                        maxHeight: 500,
                                        background: '#000',
                                        border: '1px solid #00ff00',
                                        padding: 16
                                    }}>
                                        <div style={{
                                            width: '100%',
                                            minHeight: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            {preview}
                                        </div>
                                    </ScrollView>
                                </>
                            )
                        })()}
                    </div>
                </DraggableWindow>
            )}
        </Container>
    )
}
