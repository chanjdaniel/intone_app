// RIFF WAVE files of linear PCM or 32-bit float samples, written and read
// on plain typed arrays, so the same code runs in the browser, in Workers
// and in Node.
//
// Integer samples scale by a power of two both ways (16-bit 16384 is
// exactly 0.5), so a value the encoding represents reads back unchanged;
// writing rounds to the nearest step and clamps at the top code (1.0 in
// 16 bits is 32767).

export type WavEncoding = 'pcm8' | 'pcm16' | 'pcm24' | 'pcm32' | 'float32'

export type Wav = Readonly<{
  sampleRate: number
  encoding: WavEncoding
  // One array per channel, all of one length, samples in -1..1.
  channels: ReadonlyArray<Float32Array>
}>

const bitsOf: Readonly<Record<WavEncoding, number>> = {
  pcm8: 8,
  pcm16: 16,
  pcm24: 24,
  pcm32: 32,
  float32: 32,
}

const pcmFormat = 1
const floatFormat = 3
const headerBytes = 44

const ascii = (view: DataView, offset: number, length: number): string =>
  String.fromCharCode(
    ...Array.from({ length }, (_, i) => view.getUint8(offset + i)),
  )

const writeAscii = (view: DataView, offset: number, text: string): void => {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

const quantise = (sample: number, bits: number): number => {
  const scale = 2 ** (bits - 1)
  return Math.min(scale - 1, Math.max(-scale, Math.round(sample * scale)))
}

const writeSample = (
  view: DataView,
  offset: number,
  encoding: WavEncoding,
  sample: number,
): void => {
  switch (encoding) {
    case 'pcm8':
      // 8-bit WAV samples alone are unsigned, centred on 128.
      view.setUint8(offset, quantise(sample, 8) + 128)
      return
    case 'pcm16':
      view.setInt16(offset, quantise(sample, 16), true)
      return
    case 'pcm24': {
      const value = quantise(sample, 24)
      view.setUint8(offset, value & 0xff)
      view.setInt16(offset + 1, value >> 8, true)
      return
    }
    case 'pcm32':
      view.setInt32(offset, quantise(sample, 32), true)
      return
    case 'float32':
      view.setFloat32(offset, sample, true)
  }
}

const readSample = (
  view: DataView,
  offset: number,
  encoding: WavEncoding,
): number => {
  switch (encoding) {
    case 'pcm8':
      return (view.getUint8(offset) - 128) / 128
    case 'pcm16':
      return view.getInt16(offset, true) / 32768
    case 'pcm24':
      return (
        (view.getInt16(offset + 1, true) * 256 + view.getUint8(offset)) /
        8388608
      )
    case 'pcm32':
      return view.getInt32(offset, true) / 2147483648
    case 'float32':
      return view.getFloat32(offset, true)
  }
}

export const encodeWav = ({ sampleRate, encoding, channels }: Wav): Uint8Array => {
  const length = channels[0]?.length ?? 0
  if (channels.some(channel => channel.length !== length)) {
    throw new Error('Every channel of a WAV file must have the same length.')
  }
  const bytesPerSample = bitsOf[encoding] / 8
  const blockAlign = bytesPerSample * channels.length
  const dataBytes = length * blockAlign
  const bytes = new Uint8Array(headerBytes + dataBytes)
  const view = new DataView(bytes.buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, headerBytes - 8 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, encoding === 'float32' ? floatFormat : pcmFormat, true)
  view.setUint16(22, channels.length, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsOf[encoding], true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  channels.forEach((channel, c) => {
    for (let i = 0; i < length; i++) {
      writeSample(
        view,
        headerBytes + i * blockAlign + c * bytesPerSample,
        encoding,
        channel[i] ?? 0,
      )
    }
  })
  return bytes
}

const encodingOf = (format: number, bits: number): WavEncoding => {
  if (format === floatFormat && bits === 32) {
    return 'float32'
  }
  if (format === pcmFormat) {
    switch (bits) {
      case 8:
        return 'pcm8'
      case 16:
        return 'pcm16'
      case 24:
        return 'pcm24'
      case 32:
        return 'pcm32'
    }
  }
  throw new Error(`WAV sample format ${format} with ${bits} bits is not read.`)
}

type Format = Readonly<{
  encoding: WavEncoding
  channelCount: number
  sampleRate: number
}>

export const decodeWav = (bytes: Uint8Array): Wav => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes.byteLength < 12 ||
    ascii(view, 0, 4) !== 'RIFF' ||
    ascii(view, 8, 4) !== 'WAVE'
  ) {
    throw new Error('The bytes are not a RIFF WAVE file.')
  }
  let format: Format | undefined
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = {
        encoding: encodingOf(
          view.getUint16(body, true),
          view.getUint16(body + 14, true),
        ),
        channelCount: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
      }
    } else if (id === 'data') {
      if (format === undefined) {
        throw new Error('The WAV file has samples before its format.')
      }
      const { encoding, channelCount, sampleRate } = format
      const bytesPerSample = bitsOf[encoding] / 8
      const blockAlign = bytesPerSample * channelCount
      const end = Math.min(body + size, bytes.byteLength)
      const length = Math.floor((end - body) / blockAlign)
      const channels = Array.from({ length: channelCount }, (_, c) => {
        const channel = new Float32Array(length)
        for (let i = 0; i < length; i++) {
          channel[i] = readSample(
            view,
            body + i * blockAlign + c * bytesPerSample,
            encoding,
          )
        }
        return channel
      })
      return { sampleRate, encoding, channels }
    }
    // Chunks are padded to an even size.
    offset = body + size + (size % 2)
  }
  throw new Error('The WAV file has no samples.')
}
