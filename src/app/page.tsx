'use client'

import { useEffect, useMemo, useState } from 'react'
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
} from 'react95'
import WalletButton from '@/components/wallet/WalletButton'
import { useWallet } from '@solana/wallet-adapter-react'
import { useOnchainWriter } from '@/hooks/useOnchainWriter'
import { useOnchainReader } from '@/hooks/useOnchainReader'
import { useHybridV2Reader } from '@/hooks/useHybridV2Reader'
import { readRowsByTable, readTableMeta } from '@/lib/onchainDB'
import DraggableWindow from "@/components/ui/DraggableWindow";

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
    writeRow,
  } = useOnchainWriter({ idlUrl: '/idl/iq_database.json' })

  // Writer inputs
  const [tableName, setTableName] = useState('')
  const [kvRows, setKvRows] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
  const [fetchingMeta, setFetchingMeta] = useState(false)

  // Reader navigation states
  const [viewStep, setViewStep] = useState<'tables' | 'rows'>('tables')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [rowsForSelected, setRowsForSelected] = useState<any[]>([])
  const [selectedTableColumns, setSelectedTableColumns] = useState<string[]>([])
  const [loadingRows, setLoadingRows] = useState<boolean>(false)

  // AddFile popup state
  const [showAddFilePopup, setShowAddFilePopup] = useState(false)
  const [fileProgress, setFileProgress] = useState(0)

  // Manage Table popup state
  const [showManagePopup, setShowManagePopup] = useState(false)
  const [manageCols, setManageCols] = useState<string[]>([])
  const [manageFetching, setManageFetching] = useState(false)
  const [manageExisting, setManageExisting] = useState<boolean | null>(null)

  // HybridV2 reader for session PDAs
  const { loading: loadingHybrid, error: hybridError, data: hybridData, fetchSessionData } = useHybridV2Reader()
  const [showPreviewWindow, setShowPreviewWindow] = useState(false)
  const [hoveredByteRange, setHoveredByteRange] = useState<{ start: number; end: number } | null>(null)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

  // Auto-load IDL when wallet connects
  useEffect(() => {
    if (wallet.connected) {
      loadIdl().catch(() => {})
    }
  }, [wallet.connected, loadIdl])

  const canUseWriter = useMemo(() => wallet.connected && ready, [wallet.connected, ready])

  // Reader
  const { data: readData, error: readError, loading: reading, idl: readerIdl, refresh } = useOnchainReader({
    userPublicKey: userPk,
    network: 'devnet',
    idlUrl: '/idl/iq_database.json',
    maxTx: 50,
    auto: wallet.connected, // auto fetch when connected
  })

  // 쓰기 성공 시 자동으로 새로고침
  useEffect(() => {
    if (lastSignature) {
      refresh().catch(() => {})
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
      .map(({ key, value }) => ({ key: key.trim(), value }))
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
    for (const { key, value } of entries) {
      payload[key] = parseVal(value)
    }
    await writeRow(tableName, payload)
  }

  return (
    <Container>
      {/* App bar */}
      <AppBar>
        <Toolbar>
          <ToolbarContent>
            IQ Labs DB
            <WalletButton />
          </ToolbarContent>
        </Toolbar>
      </AppBar>

      {/* Main window with tabs */}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
        <DraggableWindow title="[ iqdb_console.exe ]" width={1024}>
          <Tabs value={activeTab} onChange={onTabChange}>
            <Tab value={0}>write_data</Tab>
            <Tab value={1}>read_data</Tab>
          </Tabs>

          <TabBody style={{ minHeight: 360 }}>
            {activeTab === 0 && (
              <div>
                <GroupBox label="Write row">
                  <FieldRow>
                    <p style={{ minWidth: 100 }}>Table name</p>
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
                          const endpoint = readData?.meta?.endpoint
                          const meta = await readTableMeta({
                            userPublicKey: userPk,
                            idl: readerIdl,
                            endpoint,
                            programId: (readerIdl as any).address,
                            tableName,
                          })
                          const cols: string[] = (meta?.columns || []).map((c) => String(c).trim()).filter(Boolean)
                          if (cols.length === 0) return
                          setKvRows((prev) => {
                            const existing = new Set(prev.map((p) => p.key.trim()).filter(Boolean))
                            const missing = cols.filter((c) => !existing.has(c))
                            // 비어있는 1행만 있을 때는 해당 컬럼들로 대체
                            if (prev.length === 1 && prev[0].key.trim() === '' && prev[0].value.trim() === '') {
                              return missing.map((c) => ({ key: c, value: '' }))
                            }
                            // 그 외에는 없는 컬럼만 뒤에 추가
                            return [...prev, ...missing.map((c) => ({ key: c, value: '' }))] 
                          })
                        } finally {
                          setFetchingMeta(false)
                        }
                      }}
                    >
                      {fetchingMeta ? 'Fetching...' : 'Fetch'}
                    </Button>
                  </FieldRow>

                  <div style={{ marginTop: 8 }}>
                    <p>Data</p>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableHeadCell style={{ width: 180 }}>Column</TableHeadCell>
                          <TableHeadCell>Data</TableHeadCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {kvRows.map((pair, idx) => (
                          <TableRow key={idx}>
                            <TableDataCell>
                              <TextInput
                                placeholder="column"
                                value={pair.key}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setKvRows((rows) => {
                                    const next = rows.slice()
                                    next[idx] = { ...next[idx], key: v }
                                    return next
                                  })
                                }}
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
                                    next[idx] = { ...next[idx], value: v }
                                    return next
                                  })
                                }}
                              />
                            </TableDataCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <Button
                        size="sm"
                        onClick={() => setKvRows((rows) => [...rows, { key: '', value: '' }])}
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

                  <div style={{ marginTop: 8 }}>
                    {writeError ? <p style={{ color: '#ff5555' }}>⚠ {writeError}</p> : null}
                    {lastSignature ? <p>Sig: {lastSignature.slice(0,30)+"..."}</p> : null}
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
                      }}
                      disabled={!wallet.connected || reading}
                    >
                      Refresh
                    </Button>
                  </Row>
                  <div style={{ marginTop: 8 }}>
                    {readError ? (
                      <p style={{ color: '#ff5555' }}>⚠ {readError}</p>
                    ) : null}
                    {!wallet.connected ? <p>Connect your wallet to read data.</p> : null}
                  </div>

                  <div style={{ display: 'flex', gap: 12, marginTop: 12, minHeight: 280 }}>
                    {/* Left pane: tables list -> rows list */}
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <p style={{ margin: 0 }}>
                          {viewStep === 'tables' ? 'Tables' : selectedTable ? `Rows: ${selectedTable}` : 'Rows'}
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {viewStep === 'rows' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setViewStep('tables')
                                  setSelectedTable(null)
                                  setSelectedRowIndex(null)
                                  setRowsForSelected([])
                                  setSelectedTableColumns([])
                                }}
                              >
                                Back to tables
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      <ScrollView style={{ marginTop: 8, height: 280 }}>
                        {/* Step: tables list */}
                        {viewStep === 'tables' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {reading ? (
                              <p>Loading...</p>
                            ) : (readData?.tableNames?.length || 0) === 0 ? (
                              <p>No tables found.</p>
                            ) : (
                              readData!.tableNames.map((name) => (
                                <Button
                                  key={name}
                                  onClick={async () => {
                                    if (!readerIdl || !userPk) return
                                    setSelectedTable(name)
                                    setSelectedRowIndex(null)
                                    setViewStep('rows')
                                    setLoadingRows(true)
                                    try {
                                      const endpoint = readData?.meta?.endpoint
                                      const [rows, meta] = await Promise.all([
                                        readRowsByTable({
                                          userPublicKey: userPk,
                                          idl: readerIdl,
                                          endpoint,
                                          programId: (readerIdl as any).address,
                                          tableName: name,
                                          maxTx: 100,
                                        }),
                                        readTableMeta({
                                          userPublicKey: userPk,
                                          idl: readerIdl,
                                          endpoint,
                                          programId: (readerIdl as any).address,
                                          tableName: name,
                                        }),
                                      ])
                                      setRowsForSelected(rows)
                                      // 메타 컬럼 없으면 rows에서 키를 유추
                                      const inferred = rows && rows.length > 0 && rows[0] && typeof rows[0] === 'object'
                                        ? Object.keys(rows[0] as any)
                                        : []
                                      setSelectedTableColumns((meta?.columns?.length ?? 0) > 0 ? meta.columns : inferred)
                                    } finally {
                                      setLoadingRows(false)
                                    }
                                  }}
                                >
                                  {name}
                                </Button>
                              ))
                            )}
                          </div>
                        )}

                        {/* Step: rows list for selected table */}
                        {viewStep === 'rows' && selectedTable && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {loadingRows ? (
                              <p>Loading...</p>
                            ) : rowsForSelected.length === 0 ? (
                              <p>No rows in {selectedTable}.</p>
                            ) : (
                              <MenuList style={{ width: '100%' }}>
                                {rowsForSelected.map((row, idx) => {
                                  const selected = selectedRowIndex === idx
                                  // 라벨: raw.value → name/title → 첫 필드 → 정규식 폴백
                                  const label = (() => {
                                    try {
                                      // 0) row.raw(JSON string) → .value(내부 JSON-유사 문자열) → 첫 키의 값
                                      if (row && typeof row === 'object' && (row as any).raw && typeof (row as any).raw === 'string') {
                                        try {
                                          const outer = JSON.parse((row as any).raw)
                                          const valStr = typeof outer?.value === 'string' ? outer.value : ''
                                          if (valStr) {
                                            // 예: `{ name: "Whiteboy", gender: "Bro"}`
                                            const m0 = valStr.match(/^\s*\{\s*["']?([^"':,\s]+)["']?\s*:\s*["']?([^,"'}]+)/)
                                            if (m0?.[2]) return m0[2]
                                          }
                                        } catch {
                                          // ignore and fallback
                                        }
                                      }
                                      // 1) 흔한 키(name/title)
                                      if (row && typeof row === 'object' && !Array.isArray(row)) {
                                        if (typeof (row as any).name === 'string') return (row as any).name
                                        if (typeof (row as any).title === 'string') return (row as any).title
                                        // 2) 첫 번째 필드 값
                                        const entries = Object.entries(row)
                                        if (entries.length > 0) {
                                          const [, firstVal] = entries[0]
                                          if (typeof firstVal === 'string') return firstVal
                                          if (typeof firstVal === 'number' || typeof firstVal === 'boolean') return String(firstVal)
                                        }
                                      }
                                      // 3) 폴백: 문자열로 첫 값만 정규식으로 추출
                                      const s = JSON.stringify(row ?? '')
                                      const m = s.match(/^\s*\{\s*"?[^"}\s]+"?\s*:\s*"?([^",}]*)/)
                                      return m?.[1] || 'row'
                                    } catch {
                                      return 'row'
                                    }
                                  })()
                                  return (
                                    <MenuListItem
                                      key={idx}
                                      onClick={() => setSelectedRowIndex(idx)}
                                      primary={selected}
                                      title={typeof row === 'object' ? JSON.stringify(row) : String(row)}
                                    >
                                      {label}
                                    </MenuListItem>
                                  )
                                })}
                              </MenuList>
                            )}
                          </div>
                        )}
                      </ScrollView>
                    </div>

                    {/* Right pane: details of selected row with columns meta */}
                    <div style={{ flex: 1.2, minWidth: 320 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <p style={{ margin: 0 }}>Details</p>
                        {selectedTable ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <p>columns:</p>
                            {selectedTableColumns.length > 0 ? (
                              selectedTableColumns.map((c: string, i: number) => (
                                <span
                                  key={`${c}-${i}`}
                                  style={{ padding: '2px 6px' }}
                                >
                                  {c}
                                </span>
                              ))
                            ) : (
                              <p>none</p>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <ScrollView style={{ marginTop: 8,width:490, height: 280, paddingRight: 6 }}>
                          <div>
                        {selectedTable != null && selectedRowIndex != null ? (
                          (() => {
                            const cols: string[] =
                              (selectedTableColumns && selectedTableColumns.length > 0
                                ? selectedTableColumns
                                : (((readData as any)?.tables?.[selectedTable]?.columns as string[]) || []))
                            const row: any = rowsForSelected[selectedRowIndex] ?? {}
                            // row.raw → outer.value(내부 JSON-유사) → 객체로 파싱
                            const decoded: Record<string, any> = (() => {
                              try {
                                if (row && typeof row === 'object' && typeof row.raw === 'string') {
                                  try {
                                    const outer = JSON.parse(row.raw)
                                    let valStr: string = typeof outer?.value === 'string' ? outer.value : ''
                                    if (valStr) {
                                      // 키에 따옴표 보정 + 작은따옴표 → 큰따옴표
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

                            const clickable = new Set(['session_pda', 'sessionPda','dbLinkedListTrx','db_linked_list_trx', 'tail_tx', 'tailTx'])

                            return (
                              <>
                                {cols.length > 0 ? (
                                    <ScrollView >
                                        <div style={{width:"max-content"}}>
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
                                          <TableRow key={col} >
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
                                                <div title={String(val ?? '')}>
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
                                  <div style={{ marginTop: 12, padding: 8, background: '#001100', border: '1px solid #00ff00', maxWidth: '100%', overflow: 'hidden' }}>
                                    <p style={{ color: '#00ff00', marginBottom: 8, fontSize: 12 }}> Session Data:</p>
                                    <div style={{ marginTop: 8, fontSize: 11 }}>
                                      <div>Status: {hybridData.metadata.status}</div>
                                      <div>Chunks: {hybridData.chunksFound}/{hybridData.totalChunks}</div>
                                      <div>Type: {hybridData.fileType?.toUpperCase() || 'UNKNOWN'}</div>
                                      <div>Size: {(hybridData.decompressedData || hybridData.reconstructedData).length} bytes</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
                                  <p style={{ color: '#ff5555', marginTop: 8, fontSize: 12 }}>⚠ {hybridError}</p>
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
          initialPosition={{ x: 220, y: 140 }}
          onClose={() => setShowAddFilePopup(false)}
          width={420}
          zIndex={20000}
        >
          <div style={{ padding: 16 }}>
            <GroupBox label="add file by codein">
              <p>
                Preparing... Check progress below.
              </p>
              {/* Progress bar */}
              <ProgressBar variant="tile" value={Math.floor(fileProgress)} />
              <div style={{ marginTop: 6, textAlign: 'right', fontSize: 12, color: '#0f0' }}>
                {fileProgress}%
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <Button
                  onClick={() => {
                    // Fill existing session_pda if present; otherwise append one
                    setKvRows((rows) => {
                      const idx = rows.findIndex(r => r.key.trim() === 'session_pda' || r.key.trim() === 'sessionPda')
                      if (idx >= 0) {
                        const next = rows.slice()
                        next[idx] = { ...next[idx], value: 'examplesessionpda' }
                        return next
                      }
                      return [...rows, { key: 'session_pda', value: 'examplesessionpda' }]
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
          initialPosition={{ x: 240, y: 120 }}
          onClose={() => setShowManagePopup(false)}
          width={560}
          zIndex={20000}
        >
          <div style={{ padding: 16 }}>
            <GroupBox label="Manage table">
              <FieldRow>
                <p style={{ minWidth: 100, margin: 0 }}>Table name</p>
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
                      const endpoint = readData?.meta?.endpoint
                      const meta = await readTableMeta({
                        userPublicKey: userPk,
                        idl: readerIdl,
                        endpoint,
                        programId: (readerIdl as any).address,
                        tableName,
                      })
                      const cols = (meta?.columns || []).map((c: any) => String(c).trim()).filter(Boolean)
                      setManageExisting(cols.length > 0)
                      setManageCols(cols.length > 0 ? cols : [])
                    } finally {
                      setManageFetching(false)
                    }
                  }}
                >
                  {manageFetching ? 'Fetching...' : 'Fetch'}
                </Button>
              </FieldRow>

              <div style={{ marginTop: 12 }}>
                <p style={{ marginBottom: 6 }}>
                  {manageExisting == null
                    ? 'Enter table name and fetch to manage columns.'
                    : manageExisting
                      ? 'Existing columns (you can add or edit):'
                      : 'No existing table. Define columns to create.'}
                </p>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeadCell style={{ width: 220 }}>Column</TableHeadCell>
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
                                next[idx] = v
                                return next
                              })
                            }}
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
                              }
                            }}
                          />
                        </TableDataCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <Button
                    size="sm"
                    onClick={() => setManageCols((prev) => [...prev, ''])}
                  >
                    + Add column
                  </Button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                {manageExisting ? (
                  <Button
                    onClick={async () => {
                      if (!tableName) return
                      const cols = manageCols.map((s) => s.trim()).filter(Boolean)
                      if (cols.length === 0) return
                      try {
                        await updateColumns(tableName, cols)
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
                      try {
                        await createTable(tableName, cols)
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

      {/* File Preview Popup Window */}
      {showPreviewWindow && hybridData && (
        <DraggableWindow
          title={`[ preview ]`}
          initialPosition={{ x: 150, y: 100 }}
          onClose={() => setShowPreviewWindow(false)}
          width={1100}
          zIndex={20000}
        >
          <div style={{ padding: 16, background: '#000', minHeight: 500, display: 'flex', gap: 16 }}>
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
                <ScrollView style={{ flex: 1, minWidth: 350, maxHeight: 500, background: '#001100', padding: 12, border: '1px solid #00ff00' }}>
                  <div style={{ color: '#00ff00', marginBottom: 8, fontSize: 12, fontWeight: 'bold' }}>Magic Bytes ({detectedType.toUpperCase()}):</div>
                  <pre style={{ margin: 0, color: '#00ff00', fontSize: 11, fontFamily: 'monospace', background: '#002200', padding: 8 }}>
                    {Array.from(uint8Data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}
                  </pre>
                  <div style={{ color: '#888', marginTop: 16, marginBottom: 8, fontSize: 11 }}>
                    Hex Dump: {hoveredByteRange && `(bytes ${hoveredByteRange.start}-${hoveredByteRange.end})`}
                  </div>
                  <pre style={{ margin: 0, fontSize: 9, fontFamily: 'monospace', lineHeight: 1.6 }}>
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
                          <span key={i} style={{ color, backgroundColor: bgColor, fontWeight, textShadow }}>
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
                const blob = new Blob([uint8Data], { type: `image/${detectedType}` })
                const url = URL.createObjectURL(blob)
                preview = (
                  <img
                    src={url}
                    alt="Preview"
                    style={{ maxWidth: '100%', maxHeight: '500px', objectFit: 'contain', cursor: 'crosshair' }}
                    onLoad={(e) => {
                      const img = e.target as HTMLImageElement
                      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
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
                const blob = new Blob([uint8Data], { type: `video/${detectedType === 'mov' ? 'quicktime' : detectedType}` })
                const url = URL.createObjectURL(blob)
                preview = (
                  <video controls style={{ maxWidth: '100%', maxHeight: '500px' }}>
                    <source src={url} type={`video/${detectedType === 'mov' ? 'quicktime' : detectedType}`} />
                  </video>
                )
              }

              // PDF
              else if (detectedType === 'pdf') {
                const blob = new Blob([uint8Data], { type: 'application/pdf' })
                const url = URL.createObjectURL(blob)
                preview = <iframe src={url} style={{ width: '100%', height: '500px', border: 'none' }} />
              }

              // Text
              else if (hybridData.preview || detectedType === 'txt' || detectedType === 'json') {
                preview = (
                  <ScrollView style={{ width: '100%', maxHeight: '500px', padding: 12 }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#00ff00', fontSize: 11, fontFamily: 'monospace' }}>
                      {hybridData.preview || data.toString('utf8')}
                    </pre>
                  </ScrollView>
                )
              }

              // Unknown - just show message
              else {
                preview = (
                  <div style={{ width: '100%', padding: 40, textAlign: 'center', color: '#888' }}>
                    <div style={{ fontSize: 14, marginBottom: 8 }}>Unknown file type</div>
                    <div style={{ fontSize: 11 }}>Size: {uint8Data.length} bytes</div>
                    <div style={{ fontSize: 10, marginTop: 16 }}>Check hex dump for details</div>
                  </div>
                )
              }

              return (
                <>
                  {hexDump}
                  <ScrollView style={{ flex: 2, minWidth: 500, maxHeight: 500, background: '#000', border: '1px solid #00ff00', padding: 16 }}>
                    <div style={{ width: '100%', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
