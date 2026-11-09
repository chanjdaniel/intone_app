import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import { rmsOf } from '../support/fixture-audio.ts'
import { estimatePitch } from '../support/pitch.ts'
import { type RealVoiceLabels, realVoices } from '../support/real-voices.ts'
import { root, run } from '../support/run.ts'
import {
  conditions,
  fixtureId,
  phrases,
  roomSnrDb,
  slowerSpeedScale,
  variants,
  voices,
} from '../support/voice-fixture-set.ts'
import {
  type VoiceFixtureLabels,
  type VoiceSpan,
  speechSpansOf,
} from '../support/voice-fixtures.ts'

// The labelled fixtures in many voices (fixtures/README.md). CI remakes
// what is derived from the committed sources and compares bytes; where
// VOICEVOX CORE is set up (`npm run fixtures:voices-setup`), the sources
// are remade and compared too.

const fixtures = join(root, 'fixtures')
let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'voice-fixtures-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const filesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)))
    .sort()

const expectSameBytes = (made: string, files: ReadonlyArray<string>) => {
  for (const file of files) {
    expect(
      Buffer.compare(
        readFileSync(join(made, file)),
        readFileSync(join(fixtures, file)),
      ),
      file,
    ).toBe(0)
  }
}

const labelsOf = (id: string): VoiceFixtureLabels =>
  JSON.parse(readFileSync(join(fixtures, 'voices', `${id}.json`), 'utf8'))

const samplesOf = (
  path: string,
): Readonly<{ sampleRate: number; samples: Float32Array }> => {
  const wav = decodeWav(readFileSync(path))
  return {
    sampleRate: wav.sampleRate,
    samples: wav.channels[0] ?? new Float32Array(),
  }
}

const clean = phrases.flatMap(phrase =>
  voices.flatMap(voice =>
    variants.map(variant => fixtureId(phrase.id, voice.id, variant, 'clean')),
  ),
)

const voicevoxReady =
  existsSync(join(root, '.venv', 'bin', 'python')) &&
  existsSync(join(root, '.cache', 'voicevox', 'models')) &&
  run('ffmpeg', ['-version']).status === 0

describe('the fixtures in many voices', () => {
  test('hold every phrase, voice, variant and condition, and nothing else', () => {
    const expected = [
      'voices.json',
      ...phrases.flatMap(phrase =>
        voices.flatMap(voice =>
          variants.flatMap(variant =>
            conditions.flatMap(condition => {
              const id = fixtureId(phrase.id, voice.id, variant, condition)
              return [`${id}.json`, `${id}.wav`]
            }),
          ),
        ),
      ),
    ].sort()
    expect(expected).toHaveLength(1 + 3 * 8 * 7 * 3 * 2)
    expect(filesUnder(join(fixtures, 'voices'))).toStrictEqual(expected)
  })

  test('remake what is derived from their sources, byte for byte', () => {
    const result = run('node', [
      join(root, 'scripts', 'voice-fixtures.ts'),
      '--stage',
      'derived',
      '--out',
      scratch,
    ])
    expect(result.output).toBe('')
    expect(result.status).toBe(0)
    const made = filesUnder(scratch)
    expect(made).toStrictEqual(
      filesUnder(fixtures).filter(
        file =>
          file === 'voices/voices.json' ||
          /\.(room|phone)\.(wav|json)$/.test(file),
      ),
    )
    expectSameBytes(scratch, made)
  })

  test.skipIf(!voicevoxReady)(
    'remake their sources too, byte for byte, where VOICEVOX CORE is set up',
    () => {
      const result = run('node', [
        join(root, 'scripts', 'voice-fixtures.ts'),
        '--out',
        scratch,
      ])
      expect(result.output).toBe('')
      expect(result.status).toBe(0)
      const made = filesUnder(scratch)
      expect(made).toStrictEqual(
        filesUnder(fixtures).filter(
          file =>
            !file.startsWith('synthetic/') &&
            !file.startsWith('tracked/') &&
            file !== 'README.md',
        ),
      )
      expectSameBytes(scratch, made)
    },
    600_000,
  )
})

describe('each clean fixture', () => {
  test.each(clean)('%s is a 24 kHz WAV as long as its labels say', id => {
    const labels = labelsOf(id)
    const { sampleRate, samples } = samplesOf(
      join(fixtures, 'voices', `${id}.wav`),
    )
    expect(sampleRate).toBe(labels.sampleRate)
    expect(sampleRate).toBe(24000)
    expect(samples).toHaveLength(labels.samples)
    // Its morae follow one another inside the speech, a pause aside.
    const morae = labels.morae
    expect(morae[0]?.startSample).toBe(labels.speechStartSample)
    expect(morae.at(-1)?.endSample).toBe(labels.speechEndSample)
    for (const [k, mora] of morae.entries()) {
      expect(mora.startSample).toBeLessThanOrEqual(mora.vowelSample)
      expect(mora.vowelSample).toBeLessThan(mora.endSample)
      expect(mora.startSample).toBeGreaterThanOrEqual(
        morae[k - 1]?.endSample ?? 0,
      )
    }
    expect(morae).toHaveLength(labels.phrase.morae)
  })
})

describe('the phrases', () => {
  test('are about 4, 8 and 18 morae long', () => {
    expect(
      phrases.map(
        phrase =>
          labelsOf(fixtureId(phrase.id, voices[0]?.id ?? '', 'right', 'clean'))
            .phrase.morae,
      ),
    ).toStrictEqual([5, 8, 19])
  })

  test.each(phrases.map(phrase => phrase.id))(
    '%s has a devoiced mora, marked, with no target pitch',
    phraseId => {
      for (const voice of voices) {
        const devoiced = labelsOf(
          fixtureId(phraseId, voice.id, 'right', 'clean'),
        ).morae.filter(mora => mora.devoiced)
        expect(devoiced.length).toBeGreaterThan(0)
        for (const mora of devoiced) {
          expect(mora.targetHz).toBeNull()
        }
      }
    },
  )
})

describe('the variants', () => {
  const forEachVoice = (
    check: (
      labels: (variant: (typeof variants)[number]) => VoiceFixtureLabels,
    ) => void,
  ) => {
    for (const phrase of phrases) {
      for (const voice of voices) {
        check(variant =>
          labelsOf(fixtureId(phrase.id, voice.id, variant, 'clean')),
        )
      }
    }
  }

  const fallsOf = (labels: VoiceFixtureLabels) =>
    labels.accentPhrases.map(p => p.fallAfter)

  test('the right accent falls where the right accent does', () => {
    forEachVoice(labels => {
      const right = labels('right')
      expect(right.wrong).toBeNull()
      expect(fallsOf(right)).toStrictEqual(
        right.accentPhrases.map(p => p.rightFallAfter),
      )
    })
  })

  test('a moved fall falls elsewhere in one accent phrase', () => {
    forEachVoice(labels => {
      const moved = labels('fall-moved')
      const differ = moved.accentPhrases.filter(
        p => p.fallAfter !== p.rightFallAfter,
      )
      expect(differ).toHaveLength(1)
      expect(differ[0]?.fallAfter).not.toBeNull()
      expect(differ[0]?.rightFallAfter).not.toBeNull()
      expect(moved.wrong).toMatch(/falls after/)
    })
  })

  test('a lost fall does not fall in one accent phrase that should', () => {
    forEachVoice(labels => {
      const lost = labels('fall-lost')
      const differ = lost.accentPhrases.filter(
        p => p.fallAfter !== p.rightFallAfter,
      )
      expect(differ).toHaveLength(1)
      expect(differ[0]?.fallAfter).toBeNull()
      expect(lost.wrong).toMatch(/does not fall/)
    })
  })

  test('a changed mora changes one sound and keeps every accent', () => {
    forEachVoice(labels => {
      const changed = labels('mora-changed')
      expect(changed.morae.filter(mora => mora.changed)).toHaveLength(1)
      expect(fallsOf(changed)).toStrictEqual(fallsOf(labels('right')))
      expect(changed.morae).toHaveLength(labels('right').morae.length)
    })
  })

  test('slower and faster speech stretch the same morae', () => {
    forEachVoice(labels => {
      const speech = (l: VoiceFixtureLabels) =>
        l.speechEndSample - l.speechStartSample
      const right = speech(labels('right'))
      expect(speech(labels('slower')) / right).toBeCloseTo(
        1 / slowerSpeedScale,
        1,
      )
      expect(speech(labels('faster')) / right).toBeCloseTo(0.8, 1)
      expect(fallsOf(labels('slower'))).toStrictEqual(fallsOf(labels('right')))
    })
  })

  test('uneven timing holds some morae and clips others', () => {
    forEachVoice(labels => {
      const scales = labels('uneven').morae.map(mora => mora.vowelLengthScale)
      expect(scales.some(scale => scale > 1)).toBe(true)
      expect(scales.some(scale => scale < 1)).toBe(true)
      expect(
        labels('right').morae.every(mora => mora.vowelLengthScale === 1),
      ).toBe(true)
    })
  })
})

describe('the audio', () => {
  test('a room fixture has its noise 20 dB under its speech', () => {
    for (const phrase of phrases) {
      const id = fixtureId(phrase.id, voices[0]?.id ?? '', 'right', 'clean')
      const labels = labelsOf(id)
      const cleanSamples = samplesOf(
        join(fixtures, 'voices', `${id}.wav`),
      ).samples
      const room = samplesOf(
        join(
          fixtures,
          'voices',
          `${fixtureId(phrase.id, voices[0]?.id ?? '', 'right', 'room')}.wav`,
        ),
      ).samples
      const added = room.map((sample, n) => sample - (cleanSamples[n] ?? 0))
      const spans = speechSpansOf(labels)
      expect(
        20 * Math.log10(rmsOf(cleanSamples, spans) / rmsOf(added, spans)),
      ).toBeCloseTo(roomSnrDb, 0)
    }
  })
})

describe('the voices', () => {
  const spans: ReadonlyArray<VoiceSpan> = JSON.parse(
    readFileSync(join(fixtures, 'voices', 'voices.json'), 'utf8'),
  )

  test('are at least six, each with its credit and measured span', () => {
    expect(spans.map(span => span.id)).toStrictEqual(
      voices.map(voice => voice.id),
    )
    expect(spans.length).toBeGreaterThanOrEqual(6)
  })

  test('span low and high voices', () => {
    const medians = spans.map(span => span.medianHz)
    expect(Math.min(...medians)).toBeLessThan(140)
    expect(Math.max(...medians)).toBeGreaterThan(280)
  })

  test('span narrow and wide pitch ranges', () => {
    const widths = spans.map(span => span.spanSemitones)
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(3)
  })
})

describe('the real voices', () => {
  test.each(realVoices.map(source => source.id))(
    '%s is a CC0 LibriVox stretch, as long as its labels say, mostly voiced',
    id => {
      const labels: RealVoiceLabels = JSON.parse(
        readFileSync(join(fixtures, 'real', `${id}.json`), 'utf8'),
      )
      const { sampleRate, samples } = samplesOf(
        join(fixtures, 'real', `${id}.wav`),
      )
      expect(labels.licence).toBe('CC0 1.0')
      expect(sampleRate).toBe(labels.sampleRate)
      expect(samples).toHaveLength(labels.samples)
      expect(labels.toSample - labels.fromSample).toBe(labels.samples)
      const estimate = estimatePitch(samples, sampleRate, 50)
      const voiced = estimate.filter(Number.isFinite).length / estimate.length
      expect(voiced).toBeGreaterThan(0.3)
    },
  )
})
