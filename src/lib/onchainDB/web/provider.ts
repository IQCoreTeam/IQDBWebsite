'use client'


import * as anchor from '@coral-xyz/anchor'
import type { Idl, AnchorProvider, Program } from '@coral-xyz/anchor'
import { Connection, PublicKey, Commitment } from '@solana/web3.js'

export type WalletAdapterLike = {
  publicKey: PublicKey | null
  signTransaction: (tx: any) => Promise<any>
  signAllTransactions?: (txs: any[]) => Promise<any[]>
}

/**
 * getAnchorProvider
 * - Build an AnchorProvider from a wallet-adapter wallet + connection
 */
export function getAnchorProvider(
  connection: Connection,
  wallet: WalletAdapterLike,
  opts?: { commitment?: Commitment }
): AnchorProvider {
  if (!wallet?.publicKey || !wallet?.signTransaction) {
    throw new Error('Wallet not connected or missing capabilities')
  }
  const w: { publicKey: PublicKey; signTransaction: any; signAllTransactions: any } = {
    publicKey: wallet.publicKey,

    signTransaction: wallet.signTransaction as any,
    signAllTransactions: wallet.signAllTransactions as any,
  }
  const provider = new anchor.AnchorProvider(
    connection,
    w,
    { preflightCommitment: opts?.commitment ?? 'confirmed' }
  )
  anchor.setProvider(provider)
  return provider
}



/**
 * getProgram
 * - Instantiate an Anchor Program from IDL and programId.
 */
export function getProgram<T extends Idl>(
  idl: T,
  provider: AnchorProvider
): Program<T> {
  return new anchor.Program<T>(idl, provider)
}
