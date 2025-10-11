'use client'

import { Connection, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

const PINOCCHIO_PROGRAM_ID = '4jB7tZybufNfgs8HRj9DiSCMYfEqb8jWkxKcnZnA1vBt'

export interface HybridV2SessionMetadata {
  owner: string
  sessionId: string
  totalChunks: number
  merkleRoot: string
  status: 'active' | 'finalized'
  storageAccount: string
}

export interface HybridV2ReadResult {
  metadata: HybridV2SessionMetadata
  reconstructedData: Buffer
  decompressedData?: Buffer
  chunksFound: number
  totalChunks: number
  fileType?: string
  preview?: string
}

/**
 * Read Pinocchio session data from Solana
 */
export async function readHybridV2Session(
  sessionPubkey: string,
  rpcUrl: string
): Promise<HybridV2ReadResult> {
  const connection = new Connection(rpcUrl, 'confirmed')
  const sessionKey = new PublicKey(sessionPubkey)

  // 1. Fetch session account metadata
  const sessionAccountInfo = await connection.getAccountInfo(sessionKey)

  if (!sessionAccountInfo) {
    throw new Error('Pinocchio session account not found on-chain')
  }

  const sessionData = sessionAccountInfo.data

  // Parse Pinocchio session account (NO discriminator, NO bump)
  // Structure: owner(32) + session_id(16) + total_chunks(4) + merkle_root(32) + status(1) = 85 bytes
  const expectedSize = 32 + 16 + 4 + 32 + 1
  if (sessionData.length < expectedSize) {
    throw new Error(`Pinocchio session account too small: ${sessionData.length} bytes (expected ${expectedSize})`)
  }

  let offset = 0
  const owner = new PublicKey(sessionData.subarray(offset, offset + 32))
  offset += 32
  const sessionId = sessionData.subarray(offset, offset + 16)
  offset += 16
  const totalChunks = sessionData.readUInt32LE(offset)
  offset += 4
  const merkleRoot = sessionData.subarray(offset, offset + 32)
  offset += 32
  const status = sessionData.readUInt8(offset)

  // Derive storage account from owner
  const [storageAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('hybrid_storage'), owner.toBuffer()],
    new PublicKey(PINOCCHIO_PROGRAM_ID)
  )

  const metadata: HybridV2SessionMetadata = {
    owner: owner.toBase58(),
    sessionId: sessionId.toString('hex'),
    totalChunks,
    merkleRoot: merkleRoot.toString('hex'),
    status: status === 1 ? 'finalized' : 'active',
    storageAccount: storageAccount.toBase58(),
  }

  console.log('[DEBUG] Pinocchio session metadata:', metadata)

  // 2. Fetch transaction signatures for the session account
  const signatures = await connection.getSignaturesForAddress(sessionKey, { limit: 1000 })
  console.log(`[DEBUG] Found ${signatures.length} transactions`)

  // 3. Read chunks from transaction instruction data
  const chunkMap = new Map<number, Buffer>()
  let totalInstructions = 0
  let matchingDiscriminators = 0

  for (const sigInfo of signatures) {
    const tx = await connection.getTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
    })

    if (!tx?.transaction?.message) continue

    const instructions = tx.transaction.message.compiledInstructions || []

    for (const ix of instructions) {
      const data = typeof ix.data === 'string' ? bs58.decode(ix.data) : Buffer.from(ix.data)
      totalInstructions++

      // Debug first few discriminators
      if (totalInstructions <= 5) {
        console.log(`[DEBUG] Instruction ${totalInstructions} discriminator: 0x${data[0]?.toString(16).padStart(2, '0')}`)
      }

      // Pinocchio uses single-byte discriminator: 0x04 for post_hybrid_chunk
      if (data.length < 22) continue // Minimum: 1 + 16 + 4 + 1 = 22 bytes

      if (data[0] !== 0x04) continue // Check discriminator

      matchingDiscriminators++

      try {
        let chunkOffset = 1 // Skip discriminator

        // Skip session_id (16 bytes)
        chunkOffset += 16

        // Read chunk_index (u32)
        const chunkIndex = data.readUInt32LE(chunkOffset)
        chunkOffset += 4

        // Skip method (u8)
        chunkOffset += 1

        // Rest is RAW chunk data (no length prefix!)
        const chunkData = Buffer.from(data.subarray(chunkOffset))

        console.log(`[DEBUG] Pinocchio chunk ${chunkIndex}: ${chunkData.length} bytes (raw)`)
        chunkMap.set(chunkIndex, chunkData)
      } catch (e) {
        console.error('[DEBUG] Chunk extraction failed:', e)
      }
    }
  }

  console.log(`[DEBUG] Processed ${totalInstructions} instructions, ${matchingDiscriminators} matched post_chunk (0x04)`)

  if (chunkMap.size === 0) {
    throw new Error('No chunk data found in Pinocchio transactions')
  }

  // 4. Reconstruct data from chunks in order
  const sortedIndices = Array.from(chunkMap.keys()).sort((a, b) => a - b)
  const chunksArray: Buffer[] = []

  for (const idx of sortedIndices) {
    chunksArray.push(chunkMap.get(idx)!)
  }

  let reconstructedData = Buffer.concat(chunksArray)
  console.log(`[DEBUG] Reconstructed ${reconstructedData.length} bytes`)

  // 5. Check if data is base64-encoded (from file uploads)
  try {
    const firstByte = reconstructedData[0]
    if (firstByte >= 65 || firstByte === 47 || firstByte === 43) { // A-Z or / or +
      const sample = reconstructedData.slice(0, 100).toString('ascii')
      const isBase64 = /^[A-Za-z0-9+/=]+$/.test(sample.replace(/\s/g, ''))
      if (isBase64) {
        console.log('[DEBUG] Data is base64-encoded, decoding...')
        const decoded = Buffer.from(reconstructedData.toString('ascii'), 'base64')
        console.log(`[DEBUG] Base64 decoded: ${reconstructedData.length} -> ${decoded.length} bytes`)
        reconstructedData = decoded
      }
    }
  } catch (e) {
    console.log('[DEBUG] Not base64 or decode failed:', e)
  }

  // 6. Check for compression (first byte = 0x01)
  let decompressedData = reconstructedData
  if (reconstructedData.length >= 6 && reconstructedData[0] === 0x01) {
    console.log('[DEBUG] Pinocchio data has compression header (0x01)')
    // TODO: Add decompression if needed
    // For now, skip the compression header byte
    decompressedData = reconstructedData.slice(1)
  }

  // Detect file type
  const fileType = detectFileExtension(decompressedData)

  // Generate preview for text files
  let preview: string | undefined
  if (decompressedData.length < 10000) {
    const isText = decompressedData.every(
      (b: number) => (b >= 32 && b <= 126) || b === 10 || b === 13
    )
    if (isText) {
      preview = decompressedData.toString('utf8').slice(0, 500)
    }
  }

  return {
    metadata,
    reconstructedData,
    decompressedData,
    chunksFound: chunkMap.size,
    totalChunks,
    fileType,
    preview,
  }
}

/**
 * Detect file type from magic bytes
 */
function detectFileExtension(buffer: Buffer): string {
  if (buffer.length < 4) return 'bin'

  // Images
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return 'png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp'
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp'

  // Audio
  if (
    buffer.toString('ascii', 0, 3) === 'ID3' ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  )
    return 'mp3'
  if (buffer.toString('ascii', 0, 4) === 'fLaC') return 'flac'
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  )
    return 'wav'

  // Video
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12)
    if (['isom', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4A '].includes(brand)) return 'mp4'
    if (['qt  ', 'moov'].includes(brand)) return 'mov'
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'AVI '
  )
    return 'avi'
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)
    return 'webm'
  if (buffer.toString('ascii', 0, 3) === 'FLV') return 'flv'

  // Documents
  if (buffer.toString('ascii', 0, 4) === '%PDF') return 'pdf'
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const str = buffer.toString('ascii', 0, 100)
    if (str.includes('word/')) return 'docx'
    if (str.includes('xl/')) return 'xlsx'
    if (str.includes('ppt/')) return 'pptx'
    return 'zip'
  }

  // Text
  if (buffer.toString('ascii', 0, 5) === '<?xml') return 'xml'
  if (buffer.toString('ascii', 0, 1) === '{' || buffer.toString('ascii', 0, 1) === '[') {
    try {
      JSON.parse(buffer.toString('utf8'))
      return 'json'
    } catch (e) {}
  }

  // Check if it's text
  try {
    const sample = buffer.slice(0, Math.min(1024, buffer.length))
    const decoded = sample.toString('utf-8')
    const printableRatio = Array.from(decoded).filter(c => {
      const code = c.charCodeAt(0)
      return (code >= 32 && code <= 126) || c === '\n' || c === '\r' || c === '\t'
    }).length / decoded.length
    if (printableRatio > 0.9) return 'txt'
  } catch (e) {}

  return 'bin'
}
