'use client'

import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { Button, Cutout ,TextInput } from 'react95'
import { useWallet } from '@solana/wallet-adapter-react'
import DraggableWindow from '@/components/ui/DraggableWindow'
import { useOnchainWriter } from '@/hooks/useOnchainWriter'

type Props = {
  open: boolean
  onClose: () => void
}

// Simple inputs styled to fit CRT theme
const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
`

const Label = styled.label`
  min-width: 110px;
  color: #00ff00;
  font-size: 12px;
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

const Hint = styled.div`
  color: #00ff00;
  font-size: 12px;
  opacity: 0.85;
`

const ErrorText = styled.div`
  color: #ff5555;
  font-size: 12px;
  margin-top: 6px;
`

const SigText = styled.div`
  color: #00ff00;
  font-size: 12px;
  margin-top: 6px;
  word-break: break-all;
`

/**
 * WriterWindow
 * - Draggable window for on-chain write operations.
 * - Requires connected wallet; loads IDL; provides actions:
 *   - Initialize root
 *   - Create table
 *   - Write row
 */
export default function WriterWindow({ open, onClose }: Props) {
  const wallet = useWallet()
  const {
    ready,
    loading,
    error,
    lastSignature,
    loadIdl,
    initializeRoot,
    createTable,
    writeRow,
  } = useOnchainWriter({ idlUrl: '/idl/iq_database.json' })

  const [tableName, setTableName] = useState('youtube')
  const [columns, setColumns] = useState('name,session_pda')
  const [idColumn, setIdColumn] = useState<string>('')
  const [extTableName, setExtTableName] = useState<string>('')
  const [rowJson, setRowJson] = useState(`{ "name": "cat_meme", "session_pda": "xxxxx" }`)
  const [formError, setFormError] = useState<string | null>(null)

  // Auto-load IDL when wallet connects
  useEffect(() => {
    if (open && wallet.connected) {
      loadIdl().catch(() => {})
    }
  }, [open, wallet.connected, loadIdl])

  // set the default ID column if not set
  useEffect(() => {
    const cols = columns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!idColumn || (idColumn && !cols.includes(idColumn))) {
      setIdColumn(cols[0] || '')
    }
  }, [columns]) // eslint-disable-line react-hooks/exhaustive-deps

  const canUse = useMemo(() => wallet.connected && ready, [wallet.connected, ready])

  if (!open) return null

  const onClickInit = async () => {
    setFormError(null)
    await initializeRoot()
  }

  const onClickCreate = async () => {
    setFormError(null)
    const cols = columns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!tableName || cols.length === 0) {
      setFormError('Please Write the Table name and Columns')
      return
    }
    if (!idColumn) {
      setFormError('Please set the ID Column . (Default: first column)')
      return
    }
    await createTable(tableName, cols, { idColumn, extTableName: extTableName || null })
  }

  const onClickWrite = async () => {
    setFormError(null)
    if (!tableName || !rowJson) {
      setFormError('Enter The Table name Row JSON.')
      return
    }
    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(rowJson)
    } catch {
      // Allow loose JSON by wrapping as string
      parsed = { value: rowJson }
    }

    if (idColumn && !(idColumn in parsed)) {
      setFormError(` "${idColumn}" field is required in the row JSON.`)
      return
    }
    await writeRow(tableName, parsed)
  }

  return (
    <DraggableWindow
      title="writer.exe"
      initialPosition={{ x: 160, y: 180 }}
      width={560}
      onClose={onClose}
      zIndex={10000} // keep under wallet dialog
    >
      <Cutout style={{ padding: 12, marginBottom: 12 }}>
        {!wallet.connected ? (
          <Hint>Connect a wallet to start writing on-chain.</Hint>
        ) : !ready ? (
          <Hint>Loading IDL or preparing writer... (Click actions after ready)</Hint>
        ) : (
          <Hint>Writer is ready. You can create tables or write rows.</Hint>
        )}
      </Cutout>

      <Row>
        <Label htmlFor="table">Table name</Label>
        <TextInput
          id="table"
          placeholder="table name"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
        />
      </Row>

      <Row>
        <Label htmlFor="columns">Columns</Label>
        <TextInput
          id="columns"
          placeholder="col1,col2"
          value={columns}
          onChange={(e) => setColumns(e.target.value)}
        />
      </Row>

      <Row>
        <Label htmlFor="idColumn">ID Column</Label>
        <TextInput
          id="idColumn"
          placeholder="e.g. name"
          value={idColumn}
          onChange={(e) => setIdColumn(e.target.value)}
        />
      </Row>

      <Row>
        <Label htmlFor="extTable">External table</Label>
        <TextInput
          id="extTable"
          placeholder="e.g. expiration_date (optional)"
          value={extTableName}
          onChange={(e) => setExtTableName(e.target.value)}
        />
      </Row>

      <div style={{ marginBottom: 8 }}>
        <Label>Row JSON</Label>
        <TextArea
          placeholder='{"name":"cat_meme","session_pda":"xxxxx"}'
          value={rowJson}
          onChange={(e) => setRowJson(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={onClickInit} disabled={!wallet.connected || loading}>
          Initialize Root
        </Button>
        <Button onClick={onClickCreate} disabled={!canUse || loading}>
          Create Table
        </Button>
        <Button onClick={onClickWrite} disabled={!canUse || loading}>
          Write Row
        </Button>
      </div>

      {formError ? <ErrorText>⚠ {formError}</ErrorText> : null}
      {error ? <ErrorText>⚠ {error}</ErrorText> : null}
      {lastSignature ? <SigText>✅ Signature: {lastSignature}</SigText> : null}
    </DraggableWindow>
  )
}
