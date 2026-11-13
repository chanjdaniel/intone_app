import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { LoadClips } from './level/commands'
import { ClipsPage } from './level/level'
import { noProgress } from './level/progress'
import { LoadLinePlace, LoadNativeCurve } from './line/commands'
import { NativeCurve } from './line/native'
import { LinePlace } from './line/place'
import {
  AppRoute,
  Message,
  type Model,
  NavigateInternal,
  init,
  initialModel,
  update,
} from './main'
import { LoadDueLines } from './returns/commands'
import { DuePage } from './returns/returns'
import { ForgetTakeAudio } from './take/commands'
import { Take, TakeResult } from './take/take'
import {
  sampleCurve,
  sampleFeatures,
  sampleKept,
  sampleLine,
  sampleScore,
} from './take/testCurves'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const on = (route: AppRoute): Model => initialModel(route)

const noneDue = Command.resolve(
  LoadDueLines,
  Message.SucceededLoadDueLines({
    today: '2026-11-10',
    lines: [],
    maybeNextOn: Option.none(),
  }),
)

describe('init', () => {
  test('the app starts on the home screen and reads the learner’s clips', () => {
    const start = init(url('/'))

    expect((start.commands ?? []).map(({ name }) => name)).toStrictEqual([
      LoadClips.name,
      LoadDueLines.name,
    ])
    expect(start.model).toStrictEqual({
      ...on(AppRoute.Home({ maybeFind: Option.none() })),
      clips: ClipsPage.Loading(),
      due: DuePage.Loading(),
    })
  })

  test('an address the app has no page for opens the not-found screen', () => {
    expect(init(url('/nowhere')).model.route).toStrictEqual(
      AppRoute.NotFound({ path: '/nowhere' }),
    )
  })

  // Vitest runs as a development build, so the /dev routes are registered;
  // tests/e2e proves a production build has none.
  test('in development, /dev opens the component library and /dev/<name> an entry', () => {
    expect(init(url('/dev')).model.route).toStrictEqual(AppRoute.DevLibrary())
    expect(init(url('/dev/tokens')).model.route).toStrictEqual(
      AppRoute.DevEntry({ entry: 'tokens' }),
    )
  })
})

describe('update', () => {
  test('a click on a link inside the app navigates without a page load', () => {
    story(
      update,
      given(on(AppRoute.DevLibrary())),
      message(
        Message.ClickedLink({
          request: { _tag: 'Internal', url: url('/dev/tokens') },
        }),
      ),
      Command.expectExact(
        NavigateInternal({ url: 'http://localhost/dev/tokens' }),
      ),
      Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
      message(Message.ChangedUrl({ url: url('/dev/tokens') })),
      model(current => {
        expect(current.route).toStrictEqual(
          AppRoute.DevEntry({ entry: 'tokens' }),
        )
      }),
    )
  })

  test('a library that fails to load says why, until the address changes', () => {
    story(
      update,
      given(on(AppRoute.DevLibrary())),
      message(Message.FailedMountDevLibrary({ reason: 'offline' })),
      model(current => {
        expect(current.maybeDevLibraryFailure).toStrictEqual(
          Option.some('offline'),
        )
      }),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      noneDue,
      model(current => {
        expect(current).toStrictEqual({
          ...on(AppRoute.Home({ maybeFind: Option.none() })),
          clips: ClipsPage.Ready({ clips: [] }),
          due: DuePage.Ready({
            today: '2026-11-10',
            lines: [],
            maybeNextOn: Option.none(),
            shownRows: 50,
          }),
        })
      }),
    )
  })
})

describe('opening a line', () => {
  const line = AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })
  const placeLoaded = Message.SucceededLoadLinePlace({
    clipId: 'ame-ga-suki',
    lineId: '1',
    levelName: '雨が好き',
    progress: noProgress,
    maybeNext: Option.none(),
    today: '2026-11-10',
    maybeReturn: Option.none(),
  })

  test('starting on a line asks for its native curve and its place in its level', () => {
    const start = init(url('/line/ame-ga-suki/1'))
    expect(start.model.route).toStrictEqual(line)
    expect(start.model.native).toStrictEqual(
      NativeCurve.Loading({ clipId: 'ame-ga-suki', lineId: '1' }),
    )
    expect(start.model.place).toStrictEqual(
      LinePlace.Loading({ clipId: 'ame-ga-suki', lineId: '1' }),
    )
    expect(
      (start.commands ?? []).map(({ name, args }) => ({ name, args })),
    ).toStrictEqual([
      {
        name: LoadNativeCurve.name,
        args: { clipId: 'ame-ga-suki', lineId: '1' },
      },
      {
        name: LoadLinePlace.name,
        args: { clipId: 'ame-ga-suki', lineId: '1' },
      },
    ])
  })

  test('a line the app does not bring is looked for on the device, and may be missing', () => {
    story(
      update,
      given(on(AppRoute.Home({ maybeFind: Option.none() }))),
      message(Message.ChangedUrl({ url: url('/line/ame-ga-suki/9') })),
      Command.expectExact(
        LoadNativeCurve({ clipId: 'ame-ga-suki', lineId: '9' }),
        LoadLinePlace({ clipId: 'ame-ga-suki', lineId: '9' }),
      ),
      Command.resolve(
        LoadNativeCurve,
        Message.FailedLoadNativeCurve({
          clipId: 'ame-ga-suki',
          lineId: '9',
          failure: 'NoSuchLine',
          reason: 'There is no such line on this device.',
        }),
      ),
      Command.resolve(
        LoadLinePlace,
        Message.FailedLoadLinePlace({
          clipId: 'ame-ga-suki',
          lineId: '9',
          reason: 'There is no such line on this device.',
        }),
      ),
      model(current =>
        expect(current.native).toStrictEqual(
          NativeCurve.Failed({
            clipId: 'ame-ga-suki',
            lineId: '9',
            failure: 'NoSuchLine',
            reason: 'There is no such line on this device.',
          }),
        ),
      ),
    )
  })

  test('the native curve is asked for once, and again only after a failure', () => {
    story(
      update,
      given(on(AppRoute.Home({ maybeFind: Option.none() }))),
      message(Message.ChangedUrl({ url: url('/line/ame-ga-suki/1') })),
      Command.resolve(
        LoadNativeCurve,
        Message.FailedLoadNativeCurve({
          clipId: 'ame-ga-suki',
          lineId: '1',
          failure: 'Failed',
          reason: 'offline',
        }),
      ),
      Command.resolve(LoadLinePlace, placeLoaded),
      message(Message.ClickedRetryNativeCurve()),
      Command.resolve(
        LoadNativeCurve,
        Message.SucceededLoadNativeCurve({
          clipId: 'ame-ga-suki',
          lineId: '1',
          line: sampleLine,
          curve: sampleCurve,
          features: sampleFeatures,
        }),
      ),
      model(current =>
        expect(current.native).toStrictEqual(
          NativeCurve.Ready({
            clipId: 'ame-ga-suki',
            lineId: '1',
            line: sampleLine,
            curve: sampleCurve,
            features: sampleFeatures,
          }),
        ),
      ),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.resolve(ForgetTakeAudio, Message.CompletedForgetTakeAudio()),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      noneDue,
      message(Message.ChangedUrl({ url: url('/line/ame-ga-suki/1') })),
      Command.expectExact(
        LoadLinePlace({ clipId: 'ame-ga-suki', lineId: '1' }),
      ),
      model(current => {
        expect(current.native._tag).toBe('Ready')
        expect(current.place._tag).toBe('Ready')
      }),
      Command.resolve(LoadLinePlace, placeLoaded),
    )
  })

  test('leaving a line drops its take, finished or not, and what would not play there, and forgets its audio', () => {
    story(
      update,
      given({
        ...on(line),
        maybePlaybackFailure: Option.some('NotAllowedError'),
        take: Take.ShowingResult({
          mode: 'Guided',
          maybeOutcome: Option.none(),
          takeNumber: 1,
          result: TakeResult.Tracked({
            curve: sampleCurve,
            score: sampleScore,
            kept: sampleKept,
          }),
        }),
      }),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.expectExact(LoadClips(), LoadDueLines(), ForgetTakeAudio()),
      Command.resolve(ForgetTakeAudio, Message.CompletedForgetTakeAudio()),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      noneDue,
      model(current => {
        expect(current.take).toStrictEqual(Take.Idle())
        expect(current.maybePlaybackFailure).toStrictEqual(Option.none())
      }),
    )
  })
})
