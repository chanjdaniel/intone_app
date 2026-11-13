import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import { resample } from '../../src/engine/pitch/resample.ts'
import { root } from './run.ts'
import type { SoundFeatures, SoundModel } from './sound-models.ts'

// Each voice fixture's frames by each sound model, kept in the git-ignored
// .cache/sounds/ by scripts/sound-features.ts: hundreds of megabytes a
// model, too large to commit, and remade from the fixtures and the pinned
// model files alone.

export const soundFeaturesDirectory = join(root, '.cache', 'sounds', 'features')

const pathOf = (model: SoundModel, id: string): string =>
  join(soundFeaturesDirectory, model.id, `${id}.f32`)

export const fixtureSamples16k = (id: string): Float32Array => {
  const wav = decodeWav(
    readFileSync(join(root, 'fixtures', 'voices', `${id}.wav`)),
  )
  return resample(
    wav.channels[0] ?? new Float32Array(0),
    wav.sampleRate,
    16_000,
  )
}

export const hasSoundFeatures = (model: SoundModel, id: string): boolean =>
  existsSync(pathOf(model, id))

export const writeSoundFeatures = (
  model: SoundModel,
  id: string,
  features: SoundFeatures,
): void => {
  const path = pathOf(model, id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    new Uint8Array(
      features.data.buffer,
      features.data.byteOffset,
      features.data.byteLength,
    ),
  )
}

export const readSoundFeatures = (
  model: SoundModel,
  id: string,
): SoundFeatures => {
  const bytes = readFileSync(pathOf(model, id))
  const data = new Float32Array(bytes.byteLength / 4)
  new Uint8Array(data.buffer).set(bytes)
  return { frameHz: model.frameHz, dims: model.dims, data }
}
