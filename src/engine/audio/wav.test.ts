import { describe, expect, it } from 'vitest'

import { type WavEncoding, decodeWav, encodeWav } from './wav'

const ascii = (text: string): Array<number> =>
  Array.from(text, character => character.charCodeAt(0))

const uint32 = (value: number): Array<number> => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
]

const uint16 = (value: number): Array<number> => [
  value & 0xff,
  (value >>> 8) & 0xff,
]

describe('encodeWav', () => {
  it('writes a canonical 16-bit mono file, byte for byte', () => {
    const bytes = encodeWav({
      sampleRate: 8000,
      encoding: 'pcm16',
      channels: [Float32Array.of(0, 0.5, -0.5, 1, -1)],
    })
    expect(Array.from(bytes)).toStrictEqual([
      ...ascii('RIFF'),
      ...uint32(36 + 10),
      ...ascii('WAVE'),
      ...ascii('fmt '),
      ...uint32(16),
      ...uint16(1),
      ...uint16(1),
      ...uint32(8000),
      ...uint32(16000),
      ...uint16(2),
      ...uint16(16),
      ...ascii('data'),
      ...uint32(10),
      // 0, 16384, -16384, 32767 (clamped from 32768), -32768
      0x00, 0x00, 0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f, 0x00, 0x80,
    ])
  })

  it('interleaves channels and tags float samples with format 3', () => {
    const bytes = encodeWav({
      sampleRate: 48000,
      encoding: 'float32',
      channels: [Float32Array.of(0.25, 0.75), Float32Array.of(-0.25, -0.75)],
    })
    const view = new DataView(bytes.buffer, bytes.byteOffset)
    expect(view.getUint16(20, true)).toBe(3)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(28, true)).toBe(48000 * 2 * 4)
    expect(view.getUint16(32, true)).toBe(8)
    expect(view.getUint16(34, true)).toBe(32)
    expect([0, 1, 2, 3].map(i => view.getFloat32(44 + i * 4, true))).toEqual([
      0.25, -0.25, 0.75, -0.75,
    ])
  })

  it('refuses channels of different lengths', () => {
    expect(() =>
      encodeWav({
        sampleRate: 8000,
        encoding: 'pcm16',
        channels: [new Float32Array(2), new Float32Array(3)],
      }),
    ).toThrow(/same length/)
  })
})

describe('decodeWav', () => {
  // Values every encoding represents exactly: multiples of 1/128 inside
  // the 8-bit range.
  const exact = Float32Array.of(0, 0.5, -0.5, 0.25, -1, 127 / 128, -3 / 128)
  const encodings: ReadonlyArray<WavEncoding> = [
    'pcm8',
    'pcm16',
    'pcm24',
    'pcm32',
    'float32',
  ]

  it.each(encodings)(
    'reads back exactly what %s wrote, in two channels',
    encoding => {
      const right = exact.slice().reverse()
      const decoded = decodeWav(
        encodeWav({ sampleRate: 22050, encoding, channels: [exact, right] }),
      )
      expect(decoded.sampleRate).toBe(22050)
      expect(decoded.encoding).toBe(encoding)
      expect(decoded.channels).toStrictEqual([exact, right])
    },
  )

  it('rounds to the nearest 16-bit step', () => {
    const step = 1 / 32768
    const decoded = decodeWav(
      encodeWav({
        sampleRate: 8000,
        encoding: 'pcm16',
        channels: [Float32Array.of(step * 0.4, step * 0.6, -step * 1.6)],
      }),
    )
    expect(Array.from(decoded.channels[0] ?? [])).toStrictEqual([
      0,
      step,
      -2 * step,
    ])
  })

  it('skips chunks it does not read, before and after the samples', () => {
    const bytes = Uint8Array.from([
      ...ascii('RIFF'),
      ...uint32(4 + 8 + 3 + 1 + 8 + 16 + 8 + 4 + 8 + 2),
      ...ascii('WAVE'),
      ...ascii('LIST'),
      ...uint32(3),
      1,
      2,
      3,
      0, // pad byte after an odd-sized chunk
      ...ascii('fmt '),
      ...uint32(16),
      ...uint16(1),
      ...uint16(1),
      ...uint32(8000),
      ...uint32(16000),
      ...uint16(2),
      ...uint16(16),
      ...ascii('data'),
      ...uint32(4),
      0x00,
      0x40,
      0x00,
      0xc0,
      ...ascii('cue '),
      ...uint32(2),
      9,
      9,
    ])
    expect(decodeWav(bytes).channels).toStrictEqual([Float32Array.of(0.5, -0.5)])
  })

  it('refuses bytes that are not a WAV file', () => {
    expect(() => decodeWav(Uint8Array.from(ascii('OggS0000WAVE')))).toThrow(
      /not a RIFF WAVE file/,
    )
  })

  it('refuses an encoding it does not read', () => {
    const bytes = encodeWav({
      sampleRate: 8000,
      encoding: 'pcm16',
      channels: [new Float32Array(2)],
    })
    new DataView(bytes.buffer).setUint16(20, 0x55, true)
    expect(() => decodeWav(bytes)).toThrow(/format 85 with 16 bits/)
  })
})
