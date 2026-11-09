import { Mount, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { DrawCurvePair } from '../take/curvePair'
import { sampleCurve, sampleFeatures } from '../take/testCurves'
import { practiceLineOfClip } from './lines'
import { NativeCurve } from './native'

const clip = {
  format: 1 as const,
  id: 'c1',
  name: 'reading.mp3',
  addedAt: 1,
  seconds: 30,
  audio: { file: 'clips/c1.mp3', type: 'audio/mpeg', bytes: 900 },
  lines: [
    {
      id: '2',
      from: 3.5,
      to: 6.25,
      native: { _tag: 'Tracked' as const, nativeId: 'n2' },
    },
  ],
}

const onClipLine = (native: NativeCurve): Model => ({
  ...initialModel(AppRoute.Line({ clipId: 'c1', lineId: '2' })),
  native,
})

describe('the practice screen of a line of the learner’s clip', () => {
  test('names the line and its clip, and goes back to the clip’s lines', () => {
    scene(
      { update, view },
      given(
        onClipLine(
          NativeCurve.Ready({
            clipId: 'c1',
            lineId: '2',
            line: practiceLineOfClip(clip, clip.lines[0]!, clip.audio),
            curve: sampleCurve,
            features: sampleFeatures,
          }),
        ),
      ),
      Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair()),
      expect(role('heading', { name: 'Line 2', level: 1 })).toExist(),
      expect(text('reading.mp3, 0:03.5 to 0:06.2')).toExist(),
      expect(role('link', { name: /This clip’s lines/ })).toHaveAttr(
        'href',
        '/level/c1',
      ),
      expect(role('button', { name: 'Record' })).toExist(),
      expect(text('From your own clip, kept on this device.')).toExist(),
    )
  })

  test('while it is read, says so under a heading of its own', () => {
    scene(
      { update, view },
      given(onClipLine(NativeCurve.Loading({ clipId: 'c1', lineId: '2' }))),
      expect(
        role('heading', { name: 'A line of your clip', level: 1 }),
      ).toExist(),
    )
  })

  test('says why a line with no pitch cannot be copied', () => {
    scene(
      { update, view },
      given(
        onClipLine(
          NativeCurve.Failed({
            clipId: 'c1',
            lineId: '2',
            failure: 'Failed',
            reason:
              'It was too quiet to find its pitch, so it cannot be copied.',
          }),
        ),
      ),
      expect(role('alert')).toHaveText(
        "The line's pitch could not be found. It was too quiet to find its pitch, so it cannot be copied.",
      ),
    )
  })
})
