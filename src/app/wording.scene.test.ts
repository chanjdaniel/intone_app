import { Option } from 'effect'
import { Mount, expect, given, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { NativeCurve } from './line/native'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from './main'
import { DrawCurvePair } from './take/curvePair'
import { Take, TakeResult, TakeScore, levelMeterFloorDb } from './take/take'
import { sampleCurve, sampleFeatures, sampleScore } from './take/testCurves'

// The app claims only what it compared (report section 3): no screen
// says "accuracy", or that a take is correct. Every state of every
// screen is read here; tests/build/production-build.test.ts reads the
// built bundle's strings, labels included.

const line = AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })

const finishedWith = (score: TakeScore) => ({
  takeNumber: 1,
  result: TakeResult.Tracked({ curve: sampleCurve, score }),
})

const everyTake: ReadonlyArray<Take> = [
  Take.Idle(),
  Take.PlayingNative({ takeNumber: 1, tracker: 'Loading' }),
  Take.Preparing({ takeNumber: 1 }),
  Take.AwaitingMic({ takeNumber: 1 }),
  Take.MicPromptIgnored({ takeNumber: 1 }),
  Take.Recording({
    takeNumber: 1,
    elapsedSeconds: 1,
    levelDb: levelMeterFloorDb,
    maybeOnsetSeconds: Option.some(0.2),
  }),
  Take.Analysing({ takeNumber: 1 }),
  Take.ShowingResult(finishedWith(sampleScore)),
  Take.ShowingResult(finishedWith({ ...sampleScore, provisional: false })),
  ...(['TooQuiet', 'TooLittleVoiced', 'LengthMismatch'] as const).map(reason =>
    Take.ShowingResult(
      finishedWith(TakeScore.CouldNotCompare({ version: 1, reason })),
    ),
  ),
  Take.ShowingResult({ takeNumber: 1, result: TakeResult.TooQuiet() }),
  Take.ShowingResult({ takeNumber: 1, result: TakeResult.TooNoisy() }),
  Take.Listening({
    voice: 'Take',
    extent: 'WorstStretch',
    maybeTake: Option.some(finishedWith(sampleScore)),
  }),
  Take.Listening({ voice: 'Line', extent: 'Whole', maybeTake: Option.none() }),
  Take.MicDenied(),
  Take.NoMicDevice(),
  Take.MicFailed({ reason: 'busy' }),
  Take.AnalysisFailed({ reason: 'crashed' }),
]

const ready = NativeCurve.Ready({
  clipId: 'ame-ga-suki',
  lineId: '1',
  curve: sampleCurve,
  features: sampleFeatures,
})

const screens: ReadonlyArray<readonly [string, Model, boolean]> = [
  ['home', initialModel(AppRoute.Home()), false],
  ['not found', initialModel(AppRoute.NotFound({ path: '/nope' })), false],
  [
    'line loading',
    {
      ...initialModel(line),
      native: NativeCurve.Loading({ clipId: 'ame-ga-suki', lineId: '1' }),
    },
    false,
  ],
  [
    'line failed',
    {
      ...initialModel(line),
      native: NativeCurve.Failed({
        clipId: 'ame-ga-suki',
        lineId: '1',
        reason: 'gone',
      }),
    },
    false,
  ],
  ...everyTake.map(
    take =>
      [
        `line, ${take._tag}`,
        { ...initialModel(line), native: ready, take, takesStarted: 1 },
        true,
      ] as const,
  ),
]

const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())

describe('the wording', () => {
  test.each(screens)(
    'never says "accuracy" or that a take is correct: %s',
    (_name, model, drawsCurves) => {
      scene(
        { update, view },
        given(model),
        ...(drawsCurves ? [drawn] : []),
        expect(text(/accura/i)).toBeAbsent(),
        expect(text(/\b(in)?correct/i)).toBeAbsent(),
      )
    },
  )
})
