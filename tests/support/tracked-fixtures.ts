import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import {
  type SpectralOptions,
  spectralFeatures,
  spectralOptions,
} from '../../src/engine/features/spectral.ts'
import { resample } from '../../src/engine/pitch/resample.ts'
import type { SwiftF0Inference } from '../../src/engine/pitch/swift-f0.ts'
import { analyseTake } from '../../src/engine/pitch/take.ts'
import type { Curve } from '../../src/score/curve.ts'
import type { Features } from '../../src/score/features.ts'
import { root } from './run.ts'

// Every fixture's curve and features, as the app makes them: the WAV
// mixed to its first channel, resampled to 16 kHz, tracked by the take's
// own engine (src/engine/pitch/take.ts) on SwiftF0, and its spectral
// features (src/engine/features). `npm run fixtures:tracked` writes them
// to fixtures/tracked/, one file per WAV at the WAV's own path, and the
// score's tests read them there.
//
// A file is one line of JSON, padded with spaces to a multiple of 4
// bytes, then the curve's f0Hz, confidence and levelDb and the features'
// frames, each as little-endian float32.

export const trackedFormat = 1

export type TrackedHeader = Readonly<{
  format: number
  source: string
  analysis: 'Tracked' | 'TooQuiet' | 'TooNoisy'
  peakDb: number
  gainDb: number
  // The curve's frames, 0 when the take was too quiet or noisy to track.
  frames: number
  frameHz: number
  onsetFrame: number
  features: SpectralOptions & Readonly<{ frames: number; dims: number }>
}>

export type TrackedFixture = Readonly<{
  header: TrackedHeader
  curve: Curve | null
  features: Features
}>

export const trackedDirectory = join(root, 'fixtures', 'tracked')

// Every WAV under fixtures/, by its path from there, in order.
export const fixtureSources = (
  fixtures = join(root, 'fixtures'),
): ReadonlyArray<string> => {
  const found: Array<string> = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (path !== join(fixtures, 'tracked')) walk(path)
      } else if (entry.name.endsWith('.wav')) {
        found.push(relative(fixtures, path))
      }
    }
  }
  walk(fixtures)
  return found.sort()
}

export const trackedPathOf = (source: string): string =>
  source.replace(/\.wav$/, '.bin')

export const trackFixture = async (
  source: string,
  wavBytes: Uint8Array,
  infer: SwiftF0Inference,
): Promise<TrackedFixture> => {
  const wav = decodeWav(wavBytes)
  const samples = resample(
    wav.channels[0] ?? new Float32Array(0),
    wav.sampleRate,
    16_000,
  )
  const analysis = await analyseTake(samples, infer)
  const features = spectralFeatures(samples)
  const curve = analysis._tag === 'Tracked' ? analysis.curve : null
  return {
    header: {
      format: trackedFormat,
      source,
      analysis: analysis._tag,
      peakDb: analysis.peakDb,
      gainDb: analysis._tag === 'Tracked' ? analysis.gainDb : 0,
      frames: curve?.f0Hz.length ?? 0,
      frameHz: features.frameHz,
      onsetFrame: curve?.onsetFrame ?? 0,
      features: {
        ...spectralOptions,
        frames: features.data.length / features.dims,
        dims: features.dims,
      },
    },
    curve,
    features,
  }
}

export const encodeTracked = (tracked: TrackedFixture): Uint8Array => {
  let header = JSON.stringify(tracked.header)
  header += ' '.repeat((4 - ((Buffer.byteLength(header) + 1) % 4)) % 4) + '\n'
  const headerBytes = Buffer.from(header, 'utf8')
  const arrays = [
    tracked.curve?.f0Hz,
    tracked.curve?.confidence,
    tracked.curve?.levelDb,
    tracked.features.data,
  ].filter(array => array !== undefined)
  const length = arrays.reduce((sum, array) => sum + array.length * 4, 0)
  const bytes = new Uint8Array(headerBytes.length + length)
  bytes.set(headerBytes)
  const view = new DataView(bytes.buffer)
  let at = headerBytes.length
  for (const array of arrays) {
    for (const value of array) {
      view.setFloat32(at, value, true)
      at += 4
    }
  }
  return bytes
}

export const decodeTracked = (bytes: Uint8Array): TrackedFixture => {
  const newline = bytes.indexOf(10)
  const header: TrackedHeader = JSON.parse(
    Buffer.from(bytes.subarray(0, newline)).toString('utf8'),
  )
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = newline + 1
  const next = (count: number): Float32Array => {
    const array = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      array[i] = view.getFloat32(at, true)
      at += 4
    }
    return array
  }
  const curve =
    header.analysis === 'Tracked'
      ? {
          frameHz: header.frameHz,
          f0Hz: next(header.frames),
          confidence: next(header.frames),
          levelDb: next(header.frames),
          onsetFrame: header.onsetFrame,
        }
      : null
  const features = {
    frameHz: header.frameHz,
    dims: header.features.dims,
    data: next(header.features.frames * header.features.dims),
  }
  if (at !== bytes.length) {
    throw new Error(
      `${header.source}: ${bytes.length - at} bytes past the data`,
    )
  }
  return { header, curve, features }
}

// A tracked fixture by its source's path under fixtures/, without `.wav`
// (`voices/ame-ga-suki/zundamon/right.room`).
export const readTracked = (
  id: string,
  directory = trackedDirectory,
): TrackedFixture => decodeTracked(readFileSync(join(directory, `${id}.bin`)))
