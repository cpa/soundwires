export const PREAMBLE_BITS = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 1 : 0))
export const SYNC_BITS = [0, 1, 1, 1, 1, 1, 1, 0]

const MAX_PAYLOAD_BYTES = 1024 * 1024

export const bytesToBits = (bytes: Uint8Array): number[] => {
  const bits: number[] = []
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) {
      bits.push((byte >> i) & 1)
    }
  }
  return bits
}

export const bitsToBytes = (bits: number[]): Uint8Array => {
  const byteCount = Math.floor(bits.length / 8)
  const bytes = new Uint8Array(byteCount)
  for (let i = 0; i < byteCount; i += 1) {
    let value = 0
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value << 1) | (bits[i * 8 + bit] ?? 0)
    }
    bytes[i] = value
  }
  return bytes
}

export const crc16ccitt = (data: Uint8Array): number => {
  let crc = 0xffff
  for (const byte of data) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1
      crc &= 0xffff
    }
  }
  return crc
}

export const buildFrameBits = (payload: Uint8Array): number[] => {
  const lengthBytes = new Uint8Array(4)
  const view = new DataView(lengthBytes.buffer)
  view.setUint32(0, payload.length)
  const crc = crc16ccitt(payload)
  const crcBytes = new Uint8Array([crc >> 8, crc & 0xff])
  const frameBytes = new Uint8Array(4 + payload.length + 2)
  frameBytes.set(lengthBytes, 0)
  frameBytes.set(payload, 4)
  frameBytes.set(crcBytes, 4 + payload.length)
  return [...PREAMBLE_BITS, ...SYNC_BITS, ...bytesToBits(frameBytes)]
}

const bitsToUint32 = (bits: number[]): number => {
  let value = 0
  for (const bit of bits) {
    value = (value << 1) | bit
  }
  return value >>> 0
}

export const extractFrames = (bits: number[]): { frames: Uint8Array[]; remaining: number[] } => {
  const frames: Uint8Array[] = []
  const signature = [...PREAMBLE_BITS, ...SYNC_BITS]
  let cursor = 0
  while (cursor <= bits.length - signature.length) {
    let matched = true
    for (let i = 0; i < signature.length; i += 1) {
      if (bits[cursor + i] !== signature[i]) {
        matched = false
        break
      }
    }
    if (!matched) {
      cursor += 1
      continue
    }
    const frameStart = cursor + signature.length
    const lengthEnd = frameStart + 32
    if (lengthEnd > bits.length) {
      break
    }
    const lengthBits = bits.slice(frameStart, lengthEnd)
    const payloadLength = bitsToUint32(lengthBits)
    if (payloadLength > MAX_PAYLOAD_BYTES) {
      cursor += 1
      continue
    }
    const payloadEnd = lengthEnd + payloadLength * 8
    const crcEnd = payloadEnd + 16
    if (crcEnd > bits.length) {
      break
    }
    const payloadBits = bits.slice(lengthEnd, payloadEnd)
    const crcBits = bits.slice(payloadEnd, crcEnd)
    const payloadBytes = bitsToBytes(payloadBits)
    const crcValue = bitsToUint32(crcBits)
    if (crc16ccitt(payloadBytes) === crcValue) {
      frames.push(payloadBytes)
      cursor = crcEnd
    } else {
      cursor += 1
    }
  }
  return { frames, remaining: bits.slice(cursor) }
}
