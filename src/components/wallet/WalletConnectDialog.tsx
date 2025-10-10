'use client'

import { useState, useMemo } from 'react'
import styled from 'styled-components'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button, Cutout, Hourglass } from 'react95'
import DraggableWindow from '@/components/ui/DraggableWindow'

const WalletList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ErrorText = styled.div`
  color: #ff5555;
  font-size: 12px;
  margin-top: 8px;
`

type Props = {
  open: boolean
  onClose: () => void
}

/**
 * Win95-styled wallet selection dialog.
 * Renders only the window itself (no full-screen overlay).
 */
export default function WalletConnectDialog({ open, onClose }: Props) {
  const { wallets, select, connect, connecting } = useWallet()
  const [error, setError] = useState<string | null>(null)

  // Deduplicate by adapter name (avoid showing multiple entries with the same label)
  const uniqueWallets = useMemo(() => {
    const seen = new Set<string>()
    return wallets.filter((w) => {
      const name = w.adapter.name || 'Unknown'
      if (seen.has(name)) return false
      seen.add(name)
      return true
    })
  }, [wallets])

  if (!open) return null

  const handleConnect = async (adapterName: string) => {
    setError(null)
    try {
      // Select and connect using adapter name
      await select(adapterName as any)
      await connect()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to connect')
    }
  }

  return (
    <DraggableWindow
      title="[ connect_wallet.exe ]"
      initialPosition={{ x: 120, y: 120 }}
      onClose={onClose}
      width={420}
    >
      <Cutout style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ marginBottom: 8 }}>Select a wallet to connect:</div>
        <WalletList>
          {uniqueWallets.map((w) => (
            <Button
              key={w.adapter.name}
              onClick={() => handleConnect(w.adapter.name)}
              disabled={connecting}
            >
              {connecting ? <Hourglass size={16} style={{ marginRight: 8 }} /> : null}
              {w.adapter.name}
            </Button>
          ))}
        </WalletList>
        {error ? <ErrorText>⚠ {error}</ErrorText> : null}
      </Cutout>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>Close</Button>
      </div>
    </DraggableWindow>
  )
}
