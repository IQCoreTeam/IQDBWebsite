'use client'

import { useMemo } from 'react'
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
} from '@solana/wallet-adapter-wallets'
import { clusterApiUrl } from '@solana/web3.js'

export function SolanaWalletProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // Use Devnet by default (change to mainnet when needed)
  const network = WalletAdapterNetwork.Devnet
  // const endpoint = useMemo(() => clusterApiUrl(network), [network])
const endpoint = "https://devnet.helius-rpc.com/?api-key=fbb113ce-eeb4-4277-8c44-7153632d175a"
  // Supported wallets
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new TorusWalletAdapter(),
    ],
    []
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  )
}
