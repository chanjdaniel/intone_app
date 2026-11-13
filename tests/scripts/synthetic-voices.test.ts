import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import { estimatePitch, pitchError } from '../support/pitch.ts'
import { root, run } from '../support/run.ts'
import {
  type SyntheticVoiceLabels,
  voicedFramesAwayFromEdges,
} from '../support/synthetic-voice.ts'

// The synthetic voices in fixtures/synthetic/ are the fake microphone's
// test audio (docs/fake-microphone.md): `npm run fixtures:synthetic`
// writes them from a seed, and they must come out the same, byte for byte.

const committed = join(root, 'fixtures', 'synthetic')
let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'synthetic-voices-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const readLabels = (name: string): SyntheticVoiceLabels =>
  JSON.parse(readFileSync(join(committed, `${name}.json`), 'utf8'))

describe('the synthetic voices', () => {
  test('regenerate byte for byte from their seed', () => {
    const result = run('node', [
      join(root, 'scripts', 'synthetic-voices.ts'),
      '--out',
      scratch,
    ])
    expect(result.output).toBe('')
    expect(result.status).toBe(0)

    const files = readdirSync(committed).sort()
    expect(readdirSync(scratch).sort()).toStrictEqual(
      files.filter(file => file !== 'README.md'),
    )
    for (const file of readdirSync(scratch)) {
      expect(
        Buffer.compare(
          readFileSync(join(scratch, file)),
          readFileSync(join(committed, file)),
        ),
        file,
      ).toBe(0)
    }
  })

  test.each(['low', 'middle', 'high'])(
    'the %s voice sounds at the pitch its labels give',
    name => {
      const labels = readLabels(name)
      const wav = decodeWav(readFileSync(join(committed, `${name}.wav`)))
      expect(wav.sampleRate).toBe(labels.sampleRate)
      const estimate = estimatePitch(
        wav.channels[0] ?? new Float32Array(),
        wav.sampleRate,
        labels.frameHz,
      )
      const error = pitchError(
        estimate,
        labels.f0Hz,
        voicedFramesAwayFromEdges(labels),
      )
      // The estimate's own limits on a glide, not the voice's: it reads a
      // steady pitch within a cent (tests/support/pitch.test.ts).
      expect(error.frames).toBeGreaterThan(60)
      expect(error.missing).toBeLessThanOrEqual(1)
      expect(error.medianCents).toBeLessThan(3)
      expect(error.maxCents).toBeLessThan(20)
    },
  )

  test('span a low, a middle and a high range that do not overlap', () => {
    const ranges = ['low', 'middle', 'high'].map(name => {
      const voiced = readLabels(name).f0Hz.filter(
        (hz): hz is number => hz !== null,
      )
      return { lowest: Math.min(...voiced), highest: Math.max(...voiced) }
    })
    const [low, middle, high] = ranges
    expect(low?.highest).toBeLessThan(middle?.lowest ?? 0)
    expect(middle?.highest).toBeLessThan(high?.lowest ?? 0)
  })
})
