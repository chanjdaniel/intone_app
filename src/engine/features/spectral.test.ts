import { describe, expect, it } from 'vitest'

import { createRealFft } from './fft'
import { spectralFeatures, spectralOptions } from './spectral'

const tone = (hz: number, seconds: number, amplitude = 0.5) =>
  Float32Array.from(
    { length: Math.round(seconds * 16_000) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / 16_000),
  )

describe('createRealFft', () => {
  it('gives the power a plain DFT gives', () => {
    const size = 64
    const fft = createRealFft(size)
    const frame = Float32Array.from(
      { length: size },
      (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5) * 0.1,
    )
    const power = new Float32Array(size / 2 + 1)
    fft.power(frame, power)
    for (let k = 0; k <= size / 2; k++) {
      let re = 0
      let im = 0
      for (let n = 0; n < size; n++) {
        re += (frame[n] ?? 0) * Math.cos((2 * Math.PI * k * n) / size)
        im -= (frame[n] ?? 0) * Math.sin((2 * Math.PI * k * n) / size)
      }
      expect(power[k]).toBeCloseTo(re * re + im * im, 3)
    }
  })

  it('refuses a size that is not a power of 2', () => {
    expect(() => createRealFft(48)).toThrow(RangeError)
  })
})

describe('spectralFeatures', () => {
  it('gives one frame of bands per curve frame, 62.5 a second', () => {
    const features = spectralFeatures(tone(440, 1))
    expect(features.frameHz).toBe(62.5)
    expect(features.dims).toBe(spectralOptions.bands)
    expect(features.data.length).toBe(62 * spectralOptions.bands)
  })

  it('puts a tone’s energy in the band around it', () => {
    const at = (hz: number) => {
      const features = spectralFeatures(tone(hz, 0.5))
      const row = features.data.subarray(10 * features.dims, 11 * features.dims)
      return row.indexOf(Math.max(...row))
    }
    const low = at(300)
    const middle = at(1200)
    const high = at(5000)
    expect(low).toBeLessThan(middle)
    expect(middle).toBeLessThan(high)
    expect(high).toBeLessThan(spectralOptions.bands)
  })

  it('reads each frame over the 32 ms the curve’s level is read over', () => {
    // Frame f, like the curve's level, covers samples (f - 1) x 256 to
    // (f + 1) x 256: a burst in the 256 samples from 20 x 256 shows in
    // frames 20 and 21 alone.
    const samples = new Float32Array(16_000)
    for (let i = 20 * 256; i < 21 * 256; i++) samples[i] = Math.sin(i)
    const features = spectralFeatures(samples)
    const loudness = (frame: number) =>
      features.data
        .subarray(frame * features.dims, (frame + 1) * features.dims)
        .reduce((a, b) => a + b, 0)
    const silence = loudness(10)
    expect(loudness(19)).toBeCloseTo(silence, 3)
    expect(loudness(20)).toBeGreaterThan(silence + 100)
    expect(loudness(21)).toBeGreaterThan(silence + 100)
    expect(loudness(22)).toBeCloseTo(silence, 3)
  })

  it('moves every band alike when the take is louder', () => {
    const quiet = spectralFeatures(tone(700, 0.3, 0.05))
    const loud = spectralFeatures(tone(700, 0.3, 0.5))
    // Ten times the amplitude is two in log10 power, in every band the
    // tone reaches.
    const row = 8 * quiet.dims
    for (let band = 0; band < quiet.dims; band++) {
      const q = quiet.data[row + band] ?? 0
      if (q > -6) {
        expect((loud.data[row + band] ?? 0) - q).toBeCloseTo(2, 2)
      }
    }
  })
})
