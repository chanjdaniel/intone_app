import { describe, expect, it } from 'vitest'

import type { Curve } from './curve'
import { pitchTrack } from './track'

// A curve from per-frame Hz (0 for unvoiced), with a level per frame.
const curveOf = (
  f0: ReadonlyArray<number>,
  levels: ReadonlyArray<number> = f0.map(hz => (hz > 0 ? -20 : -80)),
  confidence: ReadonlyArray<number> = f0.map(hz => (hz > 0 ? 0.9 : 0)),
): Curve => ({
  frameHz: 62.5,
  f0Hz: Float32Array.from(f0),
  confidence: Float32Array.from(confidence),
  levelDb: Float32Array.from(levels),
  onsetFrame: 0,
})

const repeat = (value: number, count: number) =>
  Array.from({ length: count }, () => value)

describe('pitchTrack', () => {
  it('reads semitones around the speaker’s own median', () => {
    const track = pitchTrack(curveOf([...repeat(200, 10), ...repeat(400, 5)]))
    expect(track.semitones[0]).toBeCloseTo(0, 9)
    expect(track.semitones[14]).toBeCloseTo(12, 5)
    expect(track.voicedFrames).toBe(15)
  })

  it('gaps a frame below the confidence gate or far under the voice’s level', () => {
    const f0 = repeat(200, 12)
    const confidence = f0.map((_, f) => (f === 4 ? 0.49 : 0.9))
    const levels = f0.map((_, f) => (f === 7 ? -46 : f === 8 ? -44 : -20))
    const track = pitchTrack(curveOf(f0, levels, confidence))
    expect(Array.from(track.voiced)).toStrictEqual(
      f0.map((_, f) => (f === 4 || f === 7 ? 0 : 1)),
    )
  })

  it('outvotes an octave jump of a frame or two', () => {
    const f0 = repeat(200, 12)
    f0[3] = 400
    f0[7] = 100
    f0[8] = 100
    const track = pitchTrack(curveOf(f0))
    for (let f = 0; f < 12; f++) {
      expect(track.semitones[f], `frame ${f}`).toBeCloseTo(0, 9)
    }
  })

  it('leaves every gap a gap, however short', () => {
    const f0 = [
      ...repeat(200, 6),
      0,
      ...repeat(220, 6),
      0,
      0,
      0,
      ...repeat(240, 6),
    ]
    const track = pitchTrack(curveOf(f0))
    expect(Array.from(track.voiced)).toStrictEqual(
      f0.map(hz => (hz > 0 ? 1 : 0)),
    )
  })

  it('finds the speech from the first run of voice to the last', () => {
    // A stray voiced frame, then the voice from frame 20 to 59.
    const f0 = [
      ...repeat(0, 10),
      200,
      ...repeat(0, 9),
      ...repeat(200, 40),
      ...repeat(0, 30),
    ]
    const track = pitchTrack(curveOf(f0))
    expect([track.from, track.to]).toStrictEqual([20, 60])
  })

  it('reaches past the voice for the sound beside it, clear of the noise', () => {
    // Silence at -70 dB, a voiceless consonant at -35 before the voice,
    // and an unvoiced weak mora at -40 after a short quiet stretch.
    const f0 = [...repeat(0, 30), ...repeat(200, 30), ...repeat(0, 40)]
    const levels = f0.map((_, f) =>
      f >= 24 && f < 30
        ? -35
        : f >= 30 && f < 60
          ? -20
          : f >= 66 && f < 72
            ? -40
            : -70,
    )
    const track = pitchTrack(curveOf(f0, levels))
    expect([track.from, track.to]).toStrictEqual([24, 72])
    // Room noise at -48 dB: the consonant stands 13 dB over it and the
    // weak mora 8, under the 10 dB the speech asks.
    const noisy = levels.map(level => Math.max(level, -48))
    const inRoom = pitchTrack(curveOf(f0, noisy))
    expect([inRoom.from, inRoom.to]).toStrictEqual([24, 60])
  })

  it('reaches no further than 300 ms', () => {
    const f0 = [...repeat(0, 60), ...repeat(200, 20), ...repeat(0, 60)]
    const levels = f0.map((_, f) =>
      f >= 60 && f < 80 ? -20 : f >= 20 && f < 120 ? -30 : -80,
    )
    const track = pitchTrack(curveOf(f0, levels))
    expect([track.from, track.to]).toStrictEqual([60 - 19, 80 + 19])
  })

  it('finds no speech in a curve with no run of voice', () => {
    const track = pitchTrack(curveOf([0, 200, 200, 0, 200, 0]))
    expect(track.from).toBe(track.to)
  })
})
