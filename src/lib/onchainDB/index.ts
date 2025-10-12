// onchainDB public API for web usage
// - Keep inputs simple (strings, numbers) and outputs JSON-friendly
// - Re-export PDA utilities and configs for low-level usage

export { configs } from './configs'

// Import locally so we can use them in this module (e.g., inside getPdas)
import { pdaRoot, pdaTxRef, pdaTargetTxRef, pdaTable, pdaInstructionTable } from './provider/pda.provider'
export { pdaRoot, pdaTxRef, pdaTargetTxRef, pdaTable, pdaInstructionTable }

// Web reader API (UI-friendly)
export type { ReaderParams, ReaderResult, Row } from './web/reader'
export { readRecentRows, readRowsByTable, readTableMeta } from './web/reader'

// Web writer API (wallet-adapter + Anchor Program)
export type { EditMode, WriterCtx } from './web/writer'
export {
  initializeRootWeb,
  createTableWeb,
  updateTableColumnsWeb,
  writeRowWeb,
  pushDbInstructionWeb,
} from './web/writer'

// Low-level helper exports (optional)
export { getAnchorProvider, getProgram } from './web/provider'

// Convenience helpers (pure)
import { PublicKey } from '@solana/web3.js'

/**
 * getPdas
 * - Return common PDAs for a given user public key (base58)
 * - Useful for debugging, devtools, and low-level integrations
 */
export function getPdas(userPublicKey: string) {
  const user = new PublicKey(userPublicKey)
  return {
    root: pdaRoot(user).toBase58(),
    txRef: pdaTxRef(user).toBase58(),
    targetTxRef: pdaTargetTxRef(user).toBase58(),
  }
}