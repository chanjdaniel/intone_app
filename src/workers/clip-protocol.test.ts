import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { FromClip, ToClip, transferables } from './clip-protocol'

const quality = {
  speechFrames: 10,
  confidentShare: 0.6,
  pauseFrames: 8,
  pausePitchedShare: 0,
}

const trackedLine = () => ({
  from: 0,
  to: 16_000,
  curve: {
    _tag: 'Tracked' as const,
    frameHz: 62.5,
    f0Hz: new Float32Array(3),
    confidence: new Float32Array(3),
    levelDb: new Float32Array(3),
    onsetFrame: 0,
    featureDims: 24,
    features: new Float32Array(72),
    quality,
  },
})

describe('the clip protocol', () => {
  test('transfers the held clip, its waveform and every tracked line’s arrays', () => {
    const hold: ToClip = { _tag: 'Hold', samples: new Float32Array(8) }
    expect(transferables(hold)).toStrictEqual([hold.samples.buffer])
    const held: FromClip = { _tag: 'Held', peaks: new Uint8Array(4) }
    expect(transferables(held)).toStrictEqual([held.peaks.buffer])
    const line = trackedLine()
    const done: FromClip = {
      _tag: 'TrackDone',
      request: 3,
      lines: [line, { from: 16_000, to: 20_000, curve: { _tag: 'TooQuiet' } }],
    }
    expect(transferables(done)).toStrictEqual([
      line.curve.f0Hz.buffer,
      line.curve.confidence.buffer,
      line.curve.levelDb.buffer,
      line.curve.features.buffer,
    ])
    expect(
      transferables({ _tag: 'Track', request: 1, spans: [{ from: 0, to: 1 }] }),
    ).toStrictEqual([])
  })

  test('decodes each new message, and refuses a tracked line with no quality', () => {
    const decodeTo = Schema.decodeUnknownExit(ToClip)
    const decodeFrom = Schema.decodeUnknownExit(FromClip)
    expect(
      decodeTo({ _tag: 'Track', request: 1, spans: [{ from: 0, to: 512 }] })
        ._tag,
    ).toBe('Success')
    expect(decodeFrom({ _tag: 'Held', peaks: new Uint8Array(2) })._tag).toBe(
      'Success',
    )
    const { quality: _, ...withoutQuality } = trackedLine().curve
    expect(
      decodeFrom({
        _tag: 'CutDone',
        lines: [{ from: 0, to: 1, curve: withoutQuality }],
      })._tag,
    ).toBe('Failure')
  })
})
