import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { NativeCurve } from '../line/native'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import {
  AnalyseTake,
  FocusTakeControl,
  ForgetTakeAudio,
  WaitForMicAnswer,
} from './commands'
import { managedResources } from './resources'
import { playOf } from './subscriptions'
import { Take, TakeResult, levelMeterFloorDb } from './take'
import { sampleCurve, sampleFeatures } from './testCurves'

// The native as the take is scored against it.
const nativeRecording = { curve: sampleCurve, features: sampleFeatures }

// The bundled line's practice screen, its native curve ready.
const onLine = (take: Take = Take.Idle(), takesStarted = 0): Model => ({
  ...initialModel(AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })),
  native: NativeCurve.Ready({
    clipId: 'ame-ga-suki',
    lineId: '1',
    curve: sampleCurve,
    features: sampleFeatures,
  }),
  take,
  takesStarted,
})

// What the runtime would hold, and play, for this Model.
const holds = (state: Model) => ({
  tracker: Option.isSome(
    managedResources.tracker.modelToMaybeRequirements(state),
  ),
  microphone: Option.isSome(
    managedResources.microphone.modelToMaybeRequirements(state),
  ),
})
const plays = (state: Model): string =>
  Option.match(playOf(state), {
    onNone: () => 'nothing',
    onSome: play => play._tag,
  })

const forgot = Command.resolve(
  ForgetTakeAudio,
  Message.CompletedForgetTakeAudio(),
)

const focused = Command.resolve(
  FocusTakeControl,
  Message.CompletedFocusTakeControl(),
)

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

describe('the take, by its Model', () => {
  test('plays the line first, then holds the microphone only from asking to stop', () => {
    story(
      update,
      given(onLine()),
      message(Message.ClickedRecord()),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(
          Take.PlayingNative({ takeNumber: 1, tracker: 'Loading' }),
        )
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: false })
        expect(plays(state)).toBe('LineBeforeTake')
      }),
      message(Message.AcquiredTracker()),
      model(state => {
        expect(state.take).toStrictEqual(
          Take.PlayingNative({ takeNumber: 1, tracker: 'Ready' }),
        )
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: false })
      }),
      message(Message.EndedNativeBeforeTake({ takeNumber: 1 })),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(Take.AwaitingMic({ takeNumber: 1 }))
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: true })
        expect(plays(state)).toBe('nothing')
      }),
      Command.resolve(
        WaitForMicAnswer,
        Message.CompletedWaitForMicAnswer({ takeNumber: 1 }),
      ),
      focused,
      model(state =>
        expect(state.take).toStrictEqual(
          Take.MicPromptIgnored({ takeNumber: 1 }),
        ),
      ),
      message(Message.AcquiredMicrophone()),
      focused,
      model(state => {
        expect(state.take._tag).toBe('Recording')
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: true })
      }),
      message(Message.ClickedStop()),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(Take.Analysing({ takeNumber: 1 }))
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: false })
      }),
      Command.resolve(
        AnalyseTake,
        Message.SucceededAnalyseTake({
          takeNumber: 1,
          result: TakeResult.TooQuiet(),
        }),
      ),
      focused,
      model(state =>
        expect(holds(state)).toStrictEqual({
          tracker: false,
          microphone: false,
        }),
      ),
    )
  })

  test.each(['/elsewhere', '/dev'])(
    'releases both when the learner leaves the screen for %s mid-take',
    path => {
      story(
        update,
        given(
          onLine(
            Take.Recording({
              takeNumber: 4,
              elapsedSeconds: 3,
              levelDb: levelMeterFloorDb,
              maybeOnsetSeconds: Option.none(),
            }),
            4,
          ),
        ),
        message(Message.ChangedUrl({ url: url(path) })),
        forgot,
        model(state => {
          expect(state.take).toStrictEqual(Take.Idle())
          expect(holds(state)).toStrictEqual({
            tracker: false,
            microphone: false,
          })
        }),
      )
    },
  )

  test('says the prompt is waiting only if it is still unanswered for this take', () => {
    // The microphone answered first: the timer, when it ends, changes
    // nothing.
    const recording = onLine(
      Take.Recording({
        takeNumber: 2,
        elapsedSeconds: 1,
        levelDb: levelMeterFloorDb,
        maybeOnsetSeconds: Option.none(),
      }),
      2,
    )
    expect(
      update(recording, Message.CompletedWaitForMicAnswer({ takeNumber: 2 })),
    ).toStrictEqual({ model: recording })
    story(
      update,
      given(onLine(Take.AwaitingMic({ takeNumber: 3 }), 3)),
      message(Message.CompletedWaitForMicAnswer({ takeNumber: 2 })),
      model(state =>
        expect(state.take).toStrictEqual(Take.AwaitingMic({ takeNumber: 3 })),
      ),
      message(Message.CompletedWaitForMicAnswer({ takeNumber: 3 })),
      focused,
      model(state =>
        expect(state.take).toStrictEqual(
          Take.MicPromptIgnored({ takeNumber: 3 }),
        ),
      ),
    )
  })

  test('ignores a result that comes back for an earlier take', () => {
    story(
      update,
      given(onLine(Take.Analysing({ takeNumber: 5 }), 5)),
      message(
        Message.SucceededAnalyseTake({
          takeNumber: 4,
          result: TakeResult.TooQuiet(),
        }),
      ),
      message(Message.FailedAnalyseTake({ takeNumber: 4, reason: 'late' })),
      model(state =>
        expect(state.take).toStrictEqual(Take.Analysing({ takeNumber: 5 })),
      ),
    )
  })

  test('stops a take by itself at 30 seconds', () => {
    story(
      update,
      given(
        onLine(
          Take.Recording({
            takeNumber: 1,
            elapsedSeconds: 29.8,
            levelDb: levelMeterFloorDb,
            maybeOnsetSeconds: Option.none(),
          }),
          1,
        ),
      ),
      message(
        Message.TickedTakeMeter({
          takeNumber: 1,
          elapsedSeconds: 30.05,
          levelDb: -20,
        }),
      ),
      Command.expectExact(
        AnalyseTake({
          takeNumber: 1,
          line: { clipId: 'ame-ga-suki', lineId: '1', lineText: '雨が好き' },
          native: nativeRecording,
        }),
        FocusTakeControl(),
      ),
      model(state => {
        expect(state.take).toStrictEqual(Take.Analysing({ takeNumber: 1 }))
        expect(holds(state).microphone).toBe(false)
      }),
      focused,
      Command.resolve(
        AnalyseTake,
        Message.FailedAnalyseTake({ takeNumber: 1, reason: 'no matter' }),
      ),
      focused,
    )
  })

  test('starts no second take while one is under way', () => {
    story(
      update,
      given(
        onLine(
          Take.Recording({
            takeNumber: 1,
            elapsedSeconds: 1,
            levelDb: levelMeterFloorDb,
            maybeOnsetSeconds: Option.none(),
          }),
          1,
        ),
      ),
      message(Message.ClickedRecord()),
      model(state => {
        expect(state.takesStarted).toBe(1)
        expect(state.take._tag).toBe('Recording')
      }),
      Command.expectNone(),
    )
  })

  test('holds nothing off the line screen, whatever the take says', () => {
    const elsewhere: Model = {
      ...onLine(
        Take.Recording({
          takeNumber: 1,
          elapsedSeconds: 1,
          levelDb: levelMeterFloorDb,
          maybeOnsetSeconds: Option.none(),
        }),
        1,
      ),
      route: AppRoute.NotFound({ path: '/elsewhere' }),
    }
    expect(holds(elsewhere)).toStrictEqual({
      tracker: false,
      microphone: false,
    })
  })
})
