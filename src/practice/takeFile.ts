const HEADER_BYTES = 44

/**
 * Converts a float sample to 16 bits. Values are clamped to -1..1 and NaN
 * becomes 0. Negative values scale by 32768 and positive ones by 32767, so
 * -1 gives -32768 and 1 gives 32767.
 */
function toInt16(sample: number): number {
  if (Number.isNaN(sample)) return 0
  const clamped = Math.max(-1, Math.min(1, sample))
  return Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767)
}

/** The reverse of toInt16. */
function fromInt16(value: number): number {
  return value < 0 ? value / 32768 : value / 32767
}

function writeText(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

function readText(view: DataView, offset: number, length: number): string {
  let text = ''
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(offset + i))
  return text
}

/** Writes mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(blocks: Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const count = blocks.reduce((sum, block) => sum + block.length, 0)
  const dataBytes = count * 2
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(bytes.buffer)

  writeText(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeText(view, 8, 'WAVE')
  writeText(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeText(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = HEADER_BYTES
  for (const block of blocks) {
    for (const sample of block) {
      view.setInt16(offset, toInt16(sample), true)
      offset += 2
    }
  }
  return bytes
}

/** Reads a 16-bit PCM WAV file. Only the first channel is kept. */
export function decodeWav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 12 || readText(view, 0, 4) !== 'RIFF' || readText(view, 8, 4) !== 'WAVE') {
    throw new Error('Not a WAV file.')
  }

  let format: { channels: number; sampleRate: number; bits: number; tag: number } | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = readText(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) throw new Error('The WAV format chunk is too short.')
      format = {
        tag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      }
      if (format.tag !== 1 || format.bits !== 16 || format.channels < 1) {
        throw new Error('Only 16-bit PCM WAV files are supported.')
      }
    } else if (id === 'data') {
      if (!format) throw new Error('The WAV file has no format chunk before its data.')
      const end = Math.min(body + size, bytes.length)
      const frameBytes = format.channels * 2
      const samples = new Float32Array(Math.floor((end - body) / frameBytes))
      for (let i = 0; i < samples.length; i++) {
        samples[i] = fromInt16(view.getInt16(body + i * frameBytes, true))
      }
      return { sampleRate: format.sampleRate, samples }
    }
    // Chunks are padded to an even number of bytes.
    offset = body + size + (size % 2)
  }
  throw new Error('The WAV file has no data.')
}

/** Name of the chunk that carries a take's report inside its WAV file. */
const REPORT_CHUNK = 'rmtk'

/**
 * A recorded take as one file: the WAV of the input, with the report (what
 * the tab expected and what was heard) as JSON in an extra chunk after the
 * audio. Audio programs skip chunks they do not know, so it still plays.
 */
export function encodeTake(blocks: Float32Array[], sampleRate: number, report: unknown): Uint8Array<ArrayBuffer> {
  const wav = encodeWav(blocks, sampleRate)
  const json = new TextEncoder().encode(JSON.stringify(report))
  const padded = json.length + (json.length % 2)
  const bytes = new Uint8Array(wav.length + 8 + padded)
  bytes.set(wav)
  const view = new DataView(bytes.buffer)
  writeText(view, wav.length, REPORT_CHUNK)
  view.setUint32(wav.length + 4, json.length, true)
  bytes.set(json, wav.length + 8)
  view.setUint32(4, bytes.length - 8, true)
  return bytes
}

/** Reads a file written by encodeTake. The report is null for a plain WAV file. */
export function decodeTake(bytes: Uint8Array): { sampleRate: number; samples: Float32Array; report: unknown } {
  const audio = decodeWav(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let report: unknown = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (readText(view, offset, 4) === REPORT_CHUNK && body + size <= bytes.length) {
      report = JSON.parse(new TextDecoder().decode(bytes.subarray(body, body + size)))
    }
    offset = body + size + (size % 2)
  }
  return { ...audio, report }
}

/** Saves data as a file through the browser's download prompt. */
export function downloadFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Some browsers start the download after click() returns, so wait before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
