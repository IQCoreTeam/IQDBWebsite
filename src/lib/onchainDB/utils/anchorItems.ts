import * as anchor from '@coral-xyz/anchor'
import { Connection } from '@solana/web3.js'
import { configs } from '../configs'

/**
 * reference용 Anchor Provider 생성/조회 헬퍼
 */
export function getProvider(): anchor.AnchorProvider {
  try {
    const existing = anchor.getProvider?.()
    if (existing) {
      return existing as anchor.AnchorProvider
    }
  } catch {
    // provider 미설정 → 새로 생성
  }

  const connection = new Connection(configs.network, 'confirmed')
  const wallet = anchor.Wallet.local()
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  anchor.setProvider(provider)
  return provider
}
