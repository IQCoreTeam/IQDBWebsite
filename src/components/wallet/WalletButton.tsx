'use client'

import { useMemo, useState } from 'react'
import styled from 'styled-components'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from 'react95'
import WalletConnectDialog from './WalletConnectDialog'

const Wrap = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`



export default function WalletButton() {
  const { publicKey, connected, disconnect } = useWallet()
  const [open, setOpen] = useState(false)

  // Render short address like AbCd...wXYZ
  const shortAddress = useMemo(() => {
    if (!publicKey) return ''
    const base58 = publicKey.toBase58()
    return `${base58.slice(0, 4)}...${base58.slice(-4)}`
  }, [publicKey])

  if (connected && publicKey) {
    return (
      <Wrap>
          <Button variant='thin' disabled>{shortAddress}</Button>
        <Button onClick={disconnect} size="sm">Disconnect</Button>
        {/* Keep dialog mounted closed to avoid layout shift */}
        <WalletConnectDialog open={false} onClose={() => setOpen(false)} />
      </Wrap>
    )
  }

  return (
    <Wrap>
      <Button onClick={() => setOpen(true)}>Connect Wallet</Button>
      <WalletConnectDialog open={open} onClose={() => setOpen(false)} />
    </Wrap>
  )
}
