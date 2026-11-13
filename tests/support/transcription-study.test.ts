import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { root } from './run.ts'
import {
  boundaryShifts,
  characterError,
  normalisedText,
  studyClips,
  studyDevices,
  studyModels,
  transcriptionStudy,
} from './transcription-study.ts'

// The transcription study's measures, on text whose answer is known; and
// docs/transcription-study.md, remade from what `npm run text:study --
// --run` keeps in .cache/text-study/, which only a machine that has run
// it holds (it runs both Whisper models in Chromium, WebGPU on a real
// GPU): skipped where any run is missing, as in CI.

describe('the measures', () => {
  test('compare the words alone, without spaces or punctuation, keeping the long-vowel mark', () => {
    expect(normalisedText('「ゴン、 ギツネ」。ラーメン!')).toBe(
      'ゴンギツネラーメン',
    )
  })

  test('count character error as edits over the reference’s length', () => {
    expect(characterError('中山様', '中山様')).toBe(0)
    expect(characterError('中山', '中山様')).toBeCloseTo(1 / 3)
    expect(characterError('仲山様だ', '中山様')).toBeCloseTo(2 / 3)
    expect(characterError('', '')).toBe(0)
  })

  test('count the characters a matched edge put on the wrong side of it', () => {
    // As each line reads alone: 昔は私たちの | 村の近くの
    const own = ['昔は私たちの', '村の近くの']
    expect(boundaryShifts(['昔は私たちの', '村の近くの'], own)).toStrictEqual([
      0,
    ])
    expect(boundaryShifts(['昔は私たちの村の', '近くの'], own)).toStrictEqual([
      2,
    ])
    expect(boundaryShifts(['昔は私た', 'ちの村の近くの'], own)).toStrictEqual([
      2,
    ])
    // An edge whose line read alone heard nothing is not counted.
    expect(boundaryShifts(['昔は', ''], ['昔は', ''])).toStrictEqual([])
  })
})

const cache = join(root, '.cache', 'text-study')
const kept =
  existsSync(cache) &&
  studyClips.every(
    clip =>
      existsSync(join(cache, `${clip}.reference.json`)) &&
      studyModels.every(model =>
        studyDevices.every(device =>
          existsSync(join(cache, `${clip}.${model}.${device}.json`)),
        ),
      ),
  )

test.skipIf(!kept)(
  'docs/transcription-study.md is what the kept runs make',
  () => {
    expect(
      readFileSync(join(root, 'docs', 'transcription-study.md'), 'utf8'),
    ).toBe(transcriptionStudy(cache, root))
  },
)
