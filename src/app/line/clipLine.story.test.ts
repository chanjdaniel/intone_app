import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { AnalyseTake, FocusTakeControl } from '../take/commands'
import { managedResources } from '../take/resources'
import { playOf } from '../take/subscriptions'
import { Take, levelMeterFloorDb } from '../take/take'
import { sampleCurve, sampleFeatures } from '../take/testCurves'
import { practiceLineOfClip } from './lines'
import { NativeCurve } from './native'

// A line of the learner's own clip is practised as the bundled line is:
// the same take, its audio played from its stretch of the clip, and its
// takes kept under its clip's name.

const clip = {
  format: 1 as const,
  id: 'c1',
  name: 'reading.mp3',
  addedAt: 1,
  seconds: 30,
  audio: { file: 'clips/c1.mp3', type: 'audio/mpeg', bytes: 900 },
  lines: [
    {
      id: '1',
      from: 0.4,
      to: 3.1,
      native: { _tag: 'Tracked' as const, nativeId: 'n1' },
    },
    {
      id: '2',
      from: 3.5,
      to: 6.25,
      native: { _tag: 'Tracked' as const, nativeId: 'n2' },
    },
  ],
}
const [, clipLine] = clip.lines

const onClipLine = (take: Take): Model => ({
  ...initialModel(AppRoute.Line({ clipId: 'c1', lineId: '2' })),
  native: NativeCurve.Ready({
    clipId: 'c1',
    lineId: '2',
    line: practiceLineOfClip(clip, clipLine!, clip.audio),
    curve: sampleCurve,
    features: sampleFeatures,
  }),
  take,
  takesStarted: 1,
})

describe('a line of the learner’s clip', () => {
  test('is named by its number and where it is in the clip', () => {
    expect(practiceLineOfClip(clip, clipLine!, clip.audio)).toMatchObject({
      title: 'Line 2',
      titleIsText: false,
      detail: 'reading.mp3, 0:03.5 to 0:06.2',
      historyText: 'reading.mp3, line 2',
    })
  })

  test('plays its stretch of the clip before a take, from the clip store', () => {
    const playing = onClipLine(
      Take.PlayingNative({ mode: 'Guided', takeNumber: 1, tracker: 'Loading' }),
    )
    expect(Option.getOrThrow(playOf(playing))).toStrictEqual({
      _tag: 'LineBeforeTake',
      takeNumber: 1,
      audio: {
        _tag: 'Clip',
        file: 'clips/c1.mp3',
        type: 'audio/mpeg',
        from: 3.5,
        to: 6.25,
      },
    })
    expect(
      Option.isSome(managedResources.tracker.modelToMaybeRequirements(playing)),
    ).toBe(true)
  })

  test('keeps its takes under its clip’s name', () => {
    story(
      update,
      given(
        onClipLine(
          Take.Recording({
            mode: 'Guided',
            takeNumber: 1,
            elapsedSeconds: 2,
            levelDb: levelMeterFloorDb,
            maybeOnsetSeconds: Option.some(0.3),
          }),
        ),
      ),
      message(Message.ClickedStop()),
      Command.expectHas(
        AnalyseTake({
          takeNumber: 1,
          mode: 'Guided',
          line: { clipId: 'c1', lineId: '2', lineText: 'reading.mp3, line 2' },
          native: { curve: sampleCurve, features: sampleFeatures },
        }),
      ),
      Command.resolve(FocusTakeControl, Message.CompletedFocusTakeControl()),
      Command.resolve(
        AnalyseTake,
        Message.FailedAnalyseTake({ takeNumber: 1, reason: 'x' }),
      ),
      Command.resolve(FocusTakeControl, Message.CompletedFocusTakeControl()),
      model(current => expect(current.take._tag).toBe('AnalysisFailed')),
    )
  })
})
