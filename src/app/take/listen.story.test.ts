import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { NativeCurve } from '../line/native'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { FocusTakeControl, WaitForMicAnswer } from './commands'
import { managedResources } from './resources'
import { playOf } from './subscriptions'
import { Take, TakeResult, TakeScore, levelMeterFloorDb } from './take'
import {
  sampleCurve,
  sampleFeatures,
  sampleKept,
  sampleLine,
  sampleScore,
} from './testCurves'

// Listening and recording, by the Model: a voice plays only while the
// Model is in a playing state, the microphone is held only while it is in
// a recording one, and no state is both.

const line = AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })

const onLine = (take: Take = Take.Idle(), takesStarted = 1): Model => ({
  ...initialModel(line),
  native: NativeCurve.Ready({
    clipId: 'ame-ga-suki',
    lineId: '1',
    line: sampleLine,
    curve: sampleCurve,
    features: sampleFeatures,
  }),
  take,
  takesStarted,
})

const plays = (state: Model): string =>
  Option.match(playOf(state), {
    onNone: () => 'nothing',
    onSome: play => play._tag,
  })

const holdsMicrophone = (state: Model): boolean =>
  Option.isSome(managedResources.microphone.modelToMaybeRequirements(state))

const tracked = TakeResult.Tracked({
  curve: sampleCurve,
  score: sampleScore,
  kept: sampleKept,
})
const finished = Take.ShowingResult({ takeNumber: 1, result: tracked })

// One of every state a take can be in.
const everyState: ReadonlyArray<Take> = [
  Take.Idle(),
  Take.PlayingNative({ takeNumber: 1, tracker: 'Loading' }),
  Take.PlayingNative({ takeNumber: 1, tracker: 'Ready' }),
  Take.Preparing({ takeNumber: 1 }),
  Take.AwaitingMic({ takeNumber: 1 }),
  Take.MicPromptIgnored({ takeNumber: 1 }),
  Take.Recording({
    takeNumber: 1,
    elapsedSeconds: 1,
    levelDb: levelMeterFloorDb,
    maybeOnsetSeconds: Option.none(),
  }),
  Take.Analysing({ takeNumber: 1 }),
  finished,
  Take.Listening({ voice: 'Line', extent: 'Whole', maybeTake: Option.none() }),
  Take.Listening({
    voice: 'Take',
    extent: 'Whole',
    maybeTake: Option.some({ takeNumber: 1, result: tracked }),
  }),
  Take.Listening({
    voice: 'Line',
    extent: 'WorstStretch',
    maybeTake: Option.some({ takeNumber: 1, result: tracked }),
  }),
  Take.Listening({
    voice: 'Take',
    extent: 'WorstStretch',
    maybeTake: Option.some({ takeNumber: 1, result: tracked }),
  }),
  Take.MicDenied(),
  Take.NoMicDevice(),
  Take.MicFailed({ reason: 'busy' }),
  Take.AnalysisFailed({ reason: 'crashed' }),
]

const focused = Command.resolve(
  FocusTakeControl,
  Message.CompletedFocusTakeControl(),
)

describe('playing and recording', () => {
  test('never happen at once, in any state a take can be in', () => {
    const states = everyState.map(take => onLine(take))
    expect(states.filter(state => plays(state) !== 'nothing')).toHaveLength(6)
    expect(states.filter(holdsMicrophone)).toHaveLength(3)
    states.forEach(state => {
      expect(plays(state) !== 'nothing' && holdsMicrophone(state)).toBe(false)
    })
  })

  test.each(['Line', 'Take'] as const)(
    'listening to the %s, whole or its worst stretch, is refused while the microphone is open',
    voice => {
      everyState
        .map(take => onLine(take))
        .filter(holdsMicrophone)
        .forEach(state => {
          ;(['Whole', 'WorstStretch'] as const).forEach(extent => {
            expect(
              update(state, Message.ClickedListen({ voice, extent })),
            ).toStrictEqual({ model: state })
          })
        })
    },
  )

  test('pressing record while listening stops the voice and plays the line', () => {
    story(
      update,
      given(
        onLine(
          Take.Listening({
            voice: 'Take',
            extent: 'Whole',
            maybeTake: Option.some({ takeNumber: 1, result: tracked }),
          }),
        ),
      ),
      message(Message.ClickedRecord()),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(
          Take.PlayingNative({ takeNumber: 2, tracker: 'Loading' }),
        )
        expect(plays(state)).toBe('LineBeforeTake')
      }),
    )
  })

  test('the microphone waits for a tracker still loading when the line ends', () => {
    story(
      update,
      given(
        onLine(Take.PlayingNative({ takeNumber: 2, tracker: 'Loading' }), 2),
      ),
      message(Message.EndedNativeBeforeTake({ takeNumber: 2 })),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(Take.Preparing({ takeNumber: 2 }))
        expect(plays(state)).toBe('nothing')
        expect(holdsMicrophone(state)).toBe(false)
      }),
      message(Message.AcquiredTracker()),
      focused,
      Command.resolve(
        WaitForMicAnswer,
        Message.CompletedWaitForMicAnswer({ takeNumber: 2 }),
      ),
      focused,
      model(state => expect(holdsMicrophone(state)).toBe(true)),
    )
  })

  test('a take waits for the line’s native curve', () => {
    const loading = {
      ...onLine(),
      native: NativeCurve.Loading({ clipId: 'ame-ga-suki', lineId: '1' }),
    }
    expect(update(loading, Message.ClickedRecord())).toStrictEqual({
      model: loading,
    })
  })
})

describe('listening again', () => {
  test('plays the line at the chosen speed, then shows the take it came from', () => {
    story(
      update,
      given(onLine(finished)),
      message(Message.SelectedListenSpeed({ speed: 0.5 })),
      message(Message.ClickedListen({ voice: 'Line', extent: 'Whole' })),
      model(state => {
        expect(playOf(state)).toStrictEqual(
          Option.some({
            _tag: 'Line',
            audio: { _tag: 'Bundled', url: expect.stringContaining('right') },
            rate: 0.5,
          }),
        )
      }),
      message(Message.EndedListening({ voice: 'Line', extent: 'Whole' })),
      model(state => expect(state.take).toStrictEqual(finished)),
      Command.expectNone(),
    )
  })

  test('plays the take from memory, and stops when asked', () => {
    story(
      update,
      given(onLine(finished)),
      message(Message.ClickedListen({ voice: 'Take', extent: 'Whole' })),
      model(state =>
        expect(playOf(state)).toStrictEqual(
          Option.some({ _tag: 'Take', takeNumber: 1 }),
        ),
      ),
      message(Message.ClickedStopListening()),
      model(state => {
        expect(state.take).toStrictEqual(finished)
        expect(plays(state)).toBe('nothing')
      }),
    )
  })

  test('has no take to hear before one has finished', () => {
    const idle = onLine()
    expect(
      update(idle, Message.ClickedListen({ voice: 'Take', extent: 'Whole' })),
    ).toStrictEqual({ model: idle })
  })

  test('a line that will not play before a take ends the take and says why', () => {
    story(
      update,
      given(onLine(Take.PlayingNative({ takeNumber: 1, tracker: 'Ready' }))),
      message(Message.FailedPlayback({ reason: 'NotAllowedError' })),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(Take.Idle())
        expect(state.maybePlaybackFailure).toStrictEqual(
          Option.some('NotAllowedError'),
        )
        expect(
          Option.isSome(
            managedResources.tracker.modelToMaybeRequirements(state),
          ),
        ).toBe(false)
      }),
      message(Message.ClickedListen({ voice: 'Line', extent: 'Whole' })),
      model(state =>
        expect(state.maybePlaybackFailure).toStrictEqual(Option.none()),
      ),
    )
  })

  test('a voice that will not play while listening goes back and says why', () => {
    story(
      update,
      given(
        onLine(
          Take.Listening({
            voice: 'Take',
            extent: 'Whole',
            maybeTake: Option.some({ takeNumber: 1, result: tracked }),
          }),
        ),
      ),
      message(
        Message.FailedPlayback({ reason: 'Your take is no longer in memory.' }),
      ),
      model(state => {
        expect(state.take).toStrictEqual(finished)
        expect(state.maybePlaybackFailure).toStrictEqual(
          Option.some('Your take is no longer in memory.'),
        )
      }),
    )
  })
})

describe('the worst stretch', () => {
  // sampleScore's worst stretch: 0.032 to 0.064 s of the line, 0.048 to
  // 0.08 s of the take.
  test('plays from the line at the chosen speed, then goes back to the result', () => {
    story(
      update,
      given({ ...onLine(finished), listenSpeed: 0.5 }),
      message(Message.ClickedListen({ voice: 'Line', extent: 'WorstStretch' })),
      model(state => {
        expect(state.take).toStrictEqual(
          Take.Listening({
            voice: 'Line',
            extent: 'WorstStretch',
            maybeTake: Option.some({ takeNumber: 1, result: tracked }),
          }),
        )
        expect(Option.getOrThrow(playOf(state))).toStrictEqual({
          _tag: 'LineStretch',
          audio: {
            _tag: 'Bundled',
            url: expect.stringMatching(/right.*\.wav$/),
          },
          rate: 0.5,
          stretch: { from: 0.032, to: 0.064 },
        })
      }),
      // The whole line's end is not the stretch's.
      message(Message.EndedListening({ voice: 'Line', extent: 'Whole' })),
      model(state => expect(state.take._tag).toBe('Listening')),
      message(
        Message.EndedListening({ voice: 'Line', extent: 'WorstStretch' }),
      ),
      model(state => expect(state.take).toStrictEqual(finished)),
    )
  })

  test('plays from the take, from memory, and stops on request', () => {
    story(
      update,
      given(onLine(finished)),
      message(Message.ClickedListen({ voice: 'Take', extent: 'WorstStretch' })),
      model(state =>
        expect(Option.getOrThrow(playOf(state))).toStrictEqual({
          _tag: 'TakeStretch',
          takeNumber: 1,
          stretch: { from: 0.048, to: 0.08 },
        }),
      ),
      // Straight from one voice's stretch to the other's.
      message(Message.ClickedListen({ voice: 'Line', extent: 'WorstStretch' })),
      model(state => expect(plays(state)).toBe('LineStretch')),
      message(Message.ClickedStopListening()),
      model(state => {
        expect(state.take).toStrictEqual(finished)
        expect(plays(state)).toBe('nothing')
      }),
    )
  })

  test('cannot be heard from a take that could not be compared', () => {
    const uncompared = Take.ShowingResult({
      takeNumber: 1,
      result: TakeResult.Tracked({
        curve: sampleCurve,
        score: TakeScore.CouldNotCompare({
          version: 1,
          reason: 'LengthMismatch',
        }),
        kept: sampleKept,
      }),
    })
    const state = onLine(uncompared)
    ;(['Line', 'Take'] as const).forEach(voice => {
      expect(
        update(state, Message.ClickedListen({ voice, extent: 'WorstStretch' })),
      ).toStrictEqual({ model: state })
      // The whole voices still play.
      expect(
        update(state, Message.ClickedListen({ voice, extent: 'Whole' })).model
          .take._tag,
      ).toBe('Listening')
    })
  })
})
