import { Effect, Stream } from 'effect'
import { Mount, click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, expect as expectValue, it, test } from 'vitest'

import { replayLive } from '../liveReplay'
import { sampleCurves } from '../sampleCurves'
import {
  DrawCurvePair,
  Message,
  init,
  meterSamples,
  update,
  view,
} from './live-curve'

const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())

describe('the live curve entry', () => {
  test('plays a voice, says when it has finished, and plays it again', () => {
    scene(
      { update, view },
      given(init().model),
      expect(text('Read-out: low, playback 1: drawing')).toExist(),
      drawn,
      expect(
        text('Read-out: low, playback 1: finished, snapped to its median'),
      ).toExist(),
      click(role('button', { name: 'Play again' })),
      expect(text('Read-out: low, playback 2: drawing')).toExist(),
      click(role('button', { name: 'Flattened' })),
      expect(text('Read-out: flattened, playback 3: drawing')).toExist(),
      expect(
        role('img', {
          name: /^Your pitch, drawn as you speak over the line's, in semitones around your typical pitch so far, coloured blue where it is close/,
        }),
      ).toExist(),
    )
  })

  test('shows the meter at each level it reads out', () => {
    scene(
      { update, view },
      given(init().model),
      drawn,
      expect(text('-60 dBFS, read as silent')).toExist(),
      expect(text('-48 dBFS, read as quiet')).toExist(),
      expect(text('-20 dBFS, read as good')).toExist(),
      expect(text('-3 dBFS, read as very loud')).toExist(),
    )
    expectValue(meterSamples).toHaveLength(4)
  })
})

describe('replayLive', () => {
  it('gives every frame of the curve once, in order, 1.25 a batch', async () => {
    const curve = sampleCurves.middle
    const frames = await Effect.runPromise(Stream.runCollect(replayLive(curve)))
    expectValue(frames.flatMap(({ f0Hz }) => Array.from(f0Hz))).toStrictEqual(
      curve.f0Hz.map(hz => Math.fround(hz)),
    )
    frames.reduce((next, { firstFrame, f0Hz }) => {
      expectValue(firstFrame).toBe(next)
      expectValue(f0Hz.length).toBeLessThanOrEqual(2)
      return next + f0Hz.length
    }, 0)
  })
})
