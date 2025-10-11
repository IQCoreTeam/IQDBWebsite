'use client'

import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import {
  AppBar,
  Toolbar,
  Window,
  WindowHeader,
    ScrollView,
    TextInput,
  WindowContent,
  Tabs,
  Tab,
  TabBody,
  GroupBox,
  Button,
} from 'react95'
import WalletButton from '@/components/wallet/WalletButton'
import { useWallet } from '@solana/wallet-adapter-react'
import { useOnchainWriter } from '@/hooks/useOnchainWriter'
import { useOnchainReader } from '@/hooks/useOnchainReader'
import { readRowsByTable } from '@/lib/onchainDB'
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

const Small = styled.div`
  color: #00ff00;
  font-size: 12px;
  opacity: 0.85;
`

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
    writeRow,
  } = useOnchainWriter({ idlUrl: '/idl/iq_database.json' })

  // Writer inputs
  const [tableName, setTableName] = useState('')
  const [columns, setColumns] = useState('')
  const [rowJson, setRowJson] = useState(``)

  // Reader navigation states
  const [viewStep, setViewStep] = useState<'tables' | 'rows'>('tables')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [rowsForSelected, setRowsForSelected] = useState<any[]>([])

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
    const cols = columns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!tableName || cols.length === 0) return
    await createTable(tableName, cols)
  }

  const onClickWrite = async () => {
    if (!tableName || !rowJson) return
    let payload: Record<string, any>
    try {
      payload = JSON.parse(rowJson)
    } catch {
      payload = { value: rowJson }
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
          <WindowContent>
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
                    </FieldRow>

                    <FieldRow>
                      <p style={{ minWidth: 100 }}>Columns (comma)</p>
                      <TextInput
                        placeholder="col1,col2"
                        value={columns}
                        onChange={(e) => setColumns(e.target.value)}
                      />
                    </FieldRow>


                    <div style={{ marginTop: 8, marginBottom: 8 }}>
                      <p>Row JSON</p>
                      <TextInput
                          multiline rows={4}
                        placeholder='{"name":"cat_meme","session_pda":"xxxxx"}'
                        value={rowJson}
                        onChange={(e) => setRowJson(e.target.value)}
                      />
                    </div>

                    <Row>
                      <Button onClick={onClickInit} disabled={!wallet.connected || writing}>
                        Initialize Root
                      </Button>
                      <Button onClick={onClickCreate} disabled={!canUseWriter || writing}>
                        Create Table
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
                        }}
                        disabled={!wallet.connected || reading}
                      >
                        Refresh
                      </Button>
                    </Row>
                    <div style={{ marginTop: 8 }}>
                      {readError ? (
                        <Small style={{ color: '#ff5555' }}>⚠ {readError}</Small>
                      ) : null}
                      {!wallet.connected ? <Small>Connect your wallet to read data.</Small> : null}
                    </div>

                    {/* Meta 영역은 숨김 처리 */}
                    {/*
                    <ScrollView style={{ marginTop: 12 }}>
                      <p>Meta</p>
                      <TextInput
                        multiline
                        variant="flat"
                        rows={3}
                        disabled
                        value={
                          readData
                            ? JSON.stringify(readData.meta, null, 2)
                            : '{}'
                        }
                      />
                    </ScrollView>
                    */}

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
                                {selectedRowIndex != null ? (
                                  <Button size="sm" onClick={() => setSelectedRowIndex(null)}>
                                    Back to rows
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setViewStep('tables')
                                    setSelectedTable(null)
                                    setSelectedRowIndex(null)
                                    setRowsForSelected([])
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
                                <Small>Loading...</Small>
                              ) : (readData?.tableNames?.length || 0) === 0 ? (
                                <Small>No tables found.</Small>
                              ) : (
                                readData!.tableNames.map((name) => (
                                  <Button
                                    key={name}
                                    onClick={async () => {
                                      if (!readerIdl || !userPk) return
                                      setSelectedTable(name)
                                      setSelectedRowIndex(null)
                                      setViewStep('rows')
                                      const endpoint = readData?.meta?.endpoint
                                      const rows = await readRowsByTable({
                                        userPublicKey: userPk,
                                        idl: readerIdl,
                                        endpoint,
                                        programId: (readerIdl as any).address,
                                        tableName: name,
                                        maxTx: 100,
                                      })
                                      setRowsForSelected(rows)
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
                              {rowsForSelected.length === 0 ? (
                                <Small>No rows in {selectedTable}.</Small>
                              ) : (
                                rowsForSelected.map((row, idx) => {
                                  const selected = selectedRowIndex === idx
                                  const short = (() => {
                                    try {
                                      if (!row || typeof row !== 'object') return String(row ?? '')
                                      if ('name' in row && typeof (row as any).name === 'string') return (row as any).name
                                      const s = JSON.stringify(row)
                                      return s.length > 60 ? s.slice(0, 57) + '...' : s
                                    } catch {
                                      return 'row'
                                    }
                                  })()
                                  return (
                                    <Button
                                      key={idx}
                                      onClick={() => setSelectedRowIndex(idx)}
                                      style={selected ? { background: '#003300', color: '#00ff00' } : undefined}
                                    >
                                      {`Row #${idx + 1} — ${short}`}
                                    </Button>
                                  )
                                })
                              )}
                            </div>
                          )}
                        </ScrollView>
                      </div>

                      {/* Right pane: details of selected row with columns meta */}
                      <div style={{ flex: 1.2, minWidth: 320 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <p style={{ margin: 0 }}>Details</p>
                          {selectedTable && (readData as any)?.tables?.[selectedTable] ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <Small>columns:</Small>
                              {(readData as any).tables[selectedTable].columns.length > 0 ? (
                                (readData as any).tables[selectedTable].columns.map((c: string, i: number) => (
                                  <span
                                    key={`${c}-${i}`}
                                    style={{ border: '1px solid #004400', padding: '2px 6px', borderRadius: 4, color: '#00ff00' }}
                                  >
                                    {c}
                                  </span>
                                ))
                              ) : (
                                <Small>none</Small>
                              )}
                            </div>
                          ) : null}
                        </div>

                        <ScrollView style={{ marginTop: 8, height: 280 }}>
                          <TextInput
                            multiline
                            variant="flat"
                            rows={14}
                            disabled
                            value={
                              selectedTable != null && selectedRowIndex != null
                                ? JSON.stringify(rowsForSelected[selectedRowIndex] ?? {}, null, 2)
                                : 'Select a row from the left.'
                            }
                          />
                        </ScrollView>
                      </div>
                    </div>
                  </GroupBox>
                </div>
              )}
            </TabBody>
          </WindowContent>
        </DraggableWindow>
      </div>
    </Container>
  )
}
