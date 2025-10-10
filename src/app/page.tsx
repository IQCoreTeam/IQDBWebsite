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
  NumberInput,
} from 'react95'
import WalletButton from '@/components/wallet/WalletButton'
import { useWallet } from '@solana/wallet-adapter-react'
import { useOnchainWriter } from '@/hooks/useOnchainWriter'
import { useOnchainReader } from '@/hooks/useOnchainReader'
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



const TextArea = styled.textarea`
  width: 100%;
  min-height: 120px;
  background: #001100;
  color: #00ff00;
  border: 1px solid #00aa00;
  padding: 8px;
  font-size: 12px;
  resize: vertical;
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
  const [amount, setAmount] = useState<number>(1) // example numeric input with NumberInput

  // Auto-load IDL when wallet connects
  useEffect(() => {
    if (wallet.connected) {
      loadIdl().catch(() => {})
    }
  }, [wallet.connected, loadIdl])

  const canUseWriter = useMemo(() => wallet.connected && ready, [wallet.connected, ready])

  // Reader
  const { data: readData, error: readError, loading: reading, refresh } = useOnchainReader({
    userPublicKey: userPk,
    network: 'devnet',
    idlUrl: '/idl/iq_database.json',
    maxTx: 50,
    auto: wallet.connected, // auto fetch when connected
  })

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
    // Optional: attach amount for demo
    if (amount != null) payload.amount = amount
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
        <DraggableWindow title="[ iqdb_console.exe ]">
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
                      <Small style={{ minWidth: 100 }}>Table name</Small>
                      <TextInput
                        placeholder="table name"
                        value={tableName}
                        onChange={(e) => setTableName(e.target.value)}
                      />
                    </FieldRow>

                    <FieldRow>
                      <Small style={{ minWidth: 100 }}>Columns (comma)</Small>
                      <TextInput
                        placeholder="col1,col2"
                        value={columns}
                        onChange={(e) => setColumns(e.target.value)}
                      />
                    </FieldRow>

                    <FieldRow>
                      <Small style={{ minWidth: 100 }}>Amount (demo)</Small>
                      <NumberInput
                        min={0}
                        defaultValue={amount}
                        onChange={(val: number) => setAmount(val)}
                        width="120px"
                      />
                    </FieldRow>

                    <div style={{ marginTop: 8, marginBottom: 8 }}>
                      <Small>Row JSON</Small>
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
                      {lastSignature ? <p>Sig: {lastSignature}</p> : null}
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
                      <Button onClick={refresh} disabled={!wallet.connected || reading}>
                        Refresh
                      </Button>
                    </Row>
                    <div style={{ marginTop: 8 }}>
                      {readError ? (
                        <Small style={{ color: '#ff5555' }}>⚠ {readError}</Small>
                      ) : null}
                      {!wallet.connected ? <Small>Connect your wallet to read data.</Small> : null}
                    </div>

                    <ScrollView style={{ marginTop: 12 }}>
                      <p>Meta</p>
                      <TextInput  multiline variant='flat'
                              rows={3} disabled>
                        {readData
                          ? JSON.stringify(readData.meta, null, 2)
                          : reading
                          ? 'Loading...'
                          : '{}'}
                      </TextInput>
                    </ScrollView>

                    <ScrollView style={{ marginTop: 12 }}>
                      <p>Tables</p>
                        <TextInput  multiline variant='flat'
                                    rows={4} disabled>
                            {readData
                          ? JSON.stringify(
                              {
                                tableNames: readData.tableNames,
                                tables: readData.tables,
                              },
                              null,
                              2
                            )
                          : reading
                          ? 'Loading...'
                          : '{}'}
                      </TextInput>
                    </ScrollView>

                    <ScrollView style={{ marginTop: 12 }}>
                      <p>Rows</p>
                        <TextInput  multiline variant='flat'
                                    rows={1} disabled>
                            {readData
                          ? JSON.stringify(readData.rowsByTable, null, 2)
                          : reading
                          ? 'Loading...'
                          : '{}'}
                      </TextInput>
                    </ScrollView>
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
