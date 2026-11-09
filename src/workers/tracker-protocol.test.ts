import { describe, expect, test } from 'vitest'

import {
  type FromTracker,
  type ToTracker,
  transferables,
} from './tracker-protocol'

describe('the tracker protocol', () => {
  test('transfers every array a message carries, never copying one', () => {
    const tracked: FromTracker = {
      _tag: 'Tracked',
      frameHz: 62.5,
      f0Hz: new Float32Array(3),
      confidence: new Float32Array(3),
      levelDb: new Float32Array(3),
      onsetFrame: 0,
      peakDb: -6,
      gainDb: 0,
      featureDims: 24,
      features: new Float32Array(72),
    }
    expect(transferables(tracked)).toStrictEqual([
      tracked.f0Hz.buffer,
      tracked.confidence.buffer,
      tracked.levelDb.buffer,
      tracked.features.buffer,
    ])
    const batch: ToTracker = { _tag: 'Batch', samples: new Float32Array(4) }
    expect(transferables(batch)).toStrictEqual([batch.samples.buffer])
    const frames: FromTracker = {
      _tag: 'Frames',
      firstFrame: 0,
      f0Hz: new Float32Array(2),
    }
    expect(transferables(frames)).toStrictEqual([frames.f0Hz.buffer])
    expect(transferables({ _tag: 'Finish' })).toStrictEqual([])
  })
})
