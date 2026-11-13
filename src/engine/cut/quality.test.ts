import { describe, expect, test } from 'vitest'

import { lineMarks, lineQuality, qualityRules } from './quality'

// A line's frames (16 ms, 256 samples) against Silero's windows (32 ms,
// 512 samples): two frames to a window. Each plan is a list of windows,
// speech or pause, with how many of their frames have a pitch.
type Window = Readonly<{ speech: boolean; pitched: 0 | 1 | 2 }>
const speech = (pitched: 0 | 1 | 2): Window => ({ speech: true, pitched })
const pause = (pitched: 0 | 1 | 2): Window => ({ speech: false, pitched })

const repeat = (count: number, window: Window): ReadonlyArray<Window> =>
  Array.from({ length: count }, () => window)

const lineOf = (windows: ReadonlyArray<Window>) => ({
  f0Hz: Float32Array.from(
    windows.flatMap(({ pitched }) => [
      pitched >= 1 ? 200 : 0,
      pitched >= 2 ? 200 : 0,
    ]),
  ),
  probabilities: Float32Array.from(windows, ({ speech: said }) =>
    said ? 0.9 : 0.05,
  ),
})

const qualityOf = (windows: ReadonlyArray<Window>) => {
  const { f0Hz, probabilities } = lineOf(windows)
  return lineQuality(f0Hz, 0, probabilities)
}

// Pause windows this near speech are left out: two each side.
const margin = 2

describe('a line’s quality', () => {
  test('counts the share of speech frames with a pitch', () => {
    const quality = qualityOf([
      ...repeat(10, pause(0)),
      ...repeat(15, speech(2)),
      ...repeat(5, speech(0)),
      ...repeat(10, pause(0)),
    ])
    expect(quality.speechFrames).toBe(40)
    expect(quality.confidentShare).toBe(30 / 40)
  })

  test('counts the pauses’ pitched frames, away from the speech', () => {
    const quality = qualityOf([
      ...repeat(10, pause(2)),
      ...repeat(20, speech(2)),
      ...repeat(10, pause(0)),
    ])
    expect(quality.pauseFrames).toBe(2 * (20 - 2 * margin))
    expect(quality.pausePitchedShare).toBe(
      (2 * (10 - margin)) / quality.pauseFrames,
    )
  })

  test('reads the probabilities from where they start in the clip', () => {
    const { f0Hz, probabilities } = lineOf([
      ...repeat(10, pause(0)),
      ...repeat(20, speech(2)),
    ])
    const padded = new Float32Array(probabilities.length + 7)
    padded.set(probabilities, 7)
    const atLine = lineQuality(f0Hz, 0, probabilities)
    expect(lineQuality(f0Hz, 3 * 512, padded, -4 * 512)).toStrictEqual(atLine)
  })

  test('a line voiced in its speech and quiet in its pauses has no mark', () => {
    const marks = lineMarks(
      qualityOf([
        ...repeat(10, pause(0)),
        ...repeat(40, speech(1)),
        ...repeat(10, pause(0)),
      ]),
    )
    expect(marks).toStrictEqual({ lowConfidence: false, likelyMusic: false })
  })

  test('little pitch in its speech marks low confidence', () => {
    const quality = qualityOf([
      ...repeat(10, pause(0)),
      ...repeat(10, speech(2)),
      ...repeat(30, speech(0)),
      ...repeat(10, pause(0)),
    ])
    expect(quality.confidentShare).toBeLessThan(qualityRules.lowConfidentShare)
    expect(lineMarks(quality).lowConfidence).toBe(true)
  })

  test('pitch through most of its pauses marks likely music', () => {
    const quality = qualityOf([
      ...repeat(10, pause(2)),
      ...repeat(40, speech(2)),
      ...repeat(10, pause(2)),
    ])
    expect(quality.pausePitchedShare).toBe(1)
    expect(lineMarks(quality).likelyMusic).toBe(true)
  })

  test('too few frames to judge mark nothing', () => {
    expect(
      lineMarks(
        qualityOf([
          ...repeat(3, pause(2)),
          ...repeat(6, speech(0)),
          ...repeat(3, pause(2)),
        ]),
      ),
    ).toStrictEqual({ lowConfidence: false, likelyMusic: false })
  })
})
