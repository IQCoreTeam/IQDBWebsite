import { NextRequest, NextResponse } from 'next/server'
import { Connection, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

const PINOCCHIO_PROGRAM_ID = '4jB7tZybufNfgs8HRj9DiSCMYfEqb8jWkxKcnZnA1vBt'

export async function POST(request: NextRequest) {
  try {
    const { sessionPubkey, rpcUrl } = await request.json()

    if (!sessionPubkey || !rpcUrl) {
      return NextResponse.json({ error: 'Missing sessionPubkey or rpcUrl' }, { status: 400 })
    }

    const connection = new Connection(rpcUrl, 'confirmed')
    const sessionKey = new PublicKey(sessionPubkey)

    // 1. Fetch session account metadata
    const sessionAccountInfo = await connection.getAccountInfo(sessionKey)

    if (!sessionAccountInfo) {
      return NextResponse.json({ error: 'Pinocchio session account not found on-chain' }, { status: 404 })
    }

    const sessionData = sessionAccountInfo.data

    // Parse Pinocchio session account
    const expectedSize = 32 + 16 + 4 + 32 + 1
    if (sessionData.length < expectedSize) {
      return NextResponse.json({
        error: `Pinocchio session account too small: ${sessionData.length} bytes (expected ${expectedSize})`
      }, { status: 400 })
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

    // Derive storage account
    const [storageAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('hybrid_storage'), owner.toBuffer()],
      new PublicKey(PINOCCHIO_PROGRAM_ID)
    )

    const metadata = {
      owner: owner.toBase58(),
      sessionId: sessionId.toString('hex'),
      totalChunks,
      merkleRoot: merkleRoot.toString('hex'),
      status: status === 1 ? 'finalized' : 'active',
      storageAccount: storageAccount.toBase58(),
    }

    console.log('[SERVER] Pinocchio session metadata:', metadata)

    // 2. Fetch transaction signatures
    const signatures = await connection.getSignaturesForAddress(sessionKey, { limit: 1000 })
    console.log(`[SERVER] Found ${signatures.length} transactions`)

    // 3. Extract chunks from transactions (PARALLEL BATCHES for speed)
    const chunkMap = new Map<number, Buffer>()
    let totalInstructions = 0
    let matchingDiscriminators = 0

    const BATCH_SIZE = 50
    for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
      const batch = signatures.slice(i, i + BATCH_SIZE)

      // Fetch transactions in parallel
      const txPromises = batch.map(sigInfo =>
        connection.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        })
      )

      const txResults = await Promise.all(txPromises)

      for (const tx of txResults) {
        if (!tx?.transaction?.message) continue

        const instructions = tx.transaction.message.compiledInstructions || []

        for (const ix of instructions) {
          const rawData = typeof ix.data === 'string' ? bs58.decode(ix.data) : ix.data
          const data = Buffer.from(rawData)
          totalInstructions++

          // Debug first few
          if (totalInstructions <= 5) {
            console.log(`[SERVER] Instruction ${totalInstructions} discriminator: 0x${data[0]?.toString(16).padStart(2, '0')}`)
          }

          // Check for Pinocchio post_hybrid_chunk (0x04)
          if (data.length < 22) continue
          if (data[0] !== 0x04) continue

          matchingDiscriminators++

          try {
            let chunkOffset = 1
            chunkOffset += 16 // Skip session_id
            const chunkIndex = data.readUInt32LE(chunkOffset)
            chunkOffset += 4
            chunkOffset += 1 // Skip method
            const chunkData = Buffer.from(data.subarray(chunkOffset))

            console.log(`[SERVER] Chunk ${chunkIndex}: ${chunkData.length} bytes`)
            chunkMap.set(chunkIndex, chunkData)
          } catch (e) {
            console.error('[SERVER] Chunk extraction failed:', e)
          }
        }
      }

      // Progress logging
      console.log(`[SERVER] Batch progress: ${Math.min(i + BATCH_SIZE, signatures.length)}/${signatures.length} txs`)
    }

    console.log(`[SERVER] Processed ${totalInstructions} instructions, ${matchingDiscriminators} matched (0x04)`)

    if (chunkMap.size === 0) {
      return NextResponse.json({
        error: 'No chunk data found in Pinocchio transactions',
        debug: {
          totalInstructions,
          matchingDiscriminators,
          transactionsScanned: signatures.length
        }
      }, { status: 404 })
    }

    // 4. Reconstruct data
    const sortedIndices = Array.from(chunkMap.keys()).sort((a, b) => a - b)
    const chunksArray: Buffer[] = []
    for (const idx of sortedIndices) {
      chunksArray.push(chunkMap.get(idx)!)
    }

    let reconstructedData = Buffer.concat(chunksArray)
    console.log(`[SERVER] Reconstructed ${reconstructedData.length} bytes`)

    // 5. Check base64 encoding
    try {
      const firstByte = reconstructedData[0]
      if (firstByte >= 65 || firstByte === 47 || firstByte === 43) {
        const sample = reconstructedData.slice(0, 100).toString('ascii')
        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(sample.replace(/\s/g, ''))
        if (isBase64) {
          console.log('[SERVER] Data is base64-encoded, decoding...')
          const decoded = Buffer.from(reconstructedData.toString('ascii'), 'base64')
          console.log(`[SERVER] Base64 decoded: ${reconstructedData.length} -> ${decoded.length} bytes`)
          reconstructedData = decoded
        }
      }
    } catch (e) {
      console.log('[SERVER] Not base64:', e)
    }

    // 6. Check compression
    let decompressedData = reconstructedData
    if (reconstructedData.length >= 6 && reconstructedData[0] === 0x01) {
      console.log('[SERVER] Compression header detected (0x01)')
      decompressedData = reconstructedData.slice(1)
    }

    // Detect file type
    const fileType = detectFileType(decompressedData)

    // Generate preview for text
    let preview: string | undefined
    if (decompressedData.length < 10000) {
      const isText = decompressedData.every(
        (b: number) => (b >= 32 && b <= 126) || b === 10 || b === 13
      )
      if (isText) {
        preview = decompressedData.toString('utf8').slice(0, 500)
      }
    }

    // Convert buffers to base64 for JSON response
    return NextResponse.json({
      metadata,
      reconstructedData: reconstructedData.toString('base64'),
      decompressedData: decompressedData.toString('base64'),
      chunksFound: chunkMap.size,
      totalChunks,
      fileType,
      preview,
    })

  } catch (error: any) {
    console.error('[SERVER] Error reading session:', error)
    return NextResponse.json({
      error: error?.message || 'Failed to read session',
      stack: error?.stack
    }, { status: 500 })
  }
}

function detectFileType(buffer: Buffer): string {
  if (buffer.length < 4) return 'bin'

  // Images
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp'

  // Video
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12)
    if (['isom', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4A '].includes(brand)) return 'mp4'
    if (['qt  ', 'moov'].includes(brand)) return 'mov'
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'AVI ') return 'avi'
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'webm'

  // Documents
  if (buffer.toString('ascii', 0, 4) === '%PDF') return 'pdf'

  // Text check
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
