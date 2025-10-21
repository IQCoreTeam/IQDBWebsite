import { keccak_256 } from '@noble/hashes/sha3'
import { Buffer } from 'buffer'

const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/
const encoder = new TextEncoder()

export function deriveSeedBytes(name: string): Uint8Array {
  const trimmed = name.trim()
  if (HEX_64_REGEX.test(trimmed)) {
    return Uint8Array.from(Buffer.from(trimmed, 'hex'))
  }
  return keccak_256(encoder.encode(trimmed))
}

export function deriveSeedHex(name: string): string {
  const trimmed = name.trim()
  if (HEX_64_REGEX.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  return Buffer.from(deriveSeedBytes(trimmed)).toString('hex')
}
