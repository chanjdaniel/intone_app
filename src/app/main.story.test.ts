import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { LoadNativeCurve } from './line/commands'
import { NativeCurve } from './line/native'
import {
  AppRoute,
  Message,
  type Model,
  NavigateInternal,
  init,
  initialModel,
  update,
} from './main'
import { ForgetTakeAudio } from './take/commands'
import { Take, TakeResult } from './take/take'
import { sampleCurve, sampleFeatures, sampleScore } from './take/testCurves'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const on = (route: AppRoute): Model => initialModel(route)

describe('init', () => {
  test('the app starts on the home screen and asks for no work', () => {
    const start = init(url('/'))

    expect(start.commands ?? []).toStrictEqual([])
    expect(start.model).toStrictEqual(on(AppRoute.Home()))
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
      model(current => {
        expect(current).toStrictEqual(on(AppRoute.Home()))
      }),
    )
  })
})

describe('opening a line', () => {
  const line = AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })

  test('starting on a line asks for its native curve', () => {
    const start = init(url('/line/ame-ga-suki/1'))
    expect(start.model.route).toStrictEqual(line)
    expect(start.model.native).toStrictEqual(
      NativeCurve.Loading({ clipId: 'ame-ga-suki', lineId: '1' }),
    )
    expect(
      (start.commands ?? []).map(({ name, args }) => ({ name, args })),
    ).toStrictEqual([
      {
        name: LoadNativeCurve.name,
        args: { clipId: 'ame-ga-suki', lineId: '1' },
      },
    ])
  })

  test('a line the app does not have asks for nothing', () => {
    const start = init(url('/line/ame-ga-suki/9'))
    expect(start.model.native).toStrictEqual(NativeCurve.NoLine())
    expect(start.commands ?? []).toStrictEqual([])
  })

  test('the native curve is asked for once, and again only after a failure', () => {
    story(
      update,
      given(on(AppRoute.Home())),
      message(Message.ChangedUrl({ url: url('/line/ame-ga-suki/1') })),
      Command.resolve(
        LoadNativeCurve,
        Message.FailedLoadNativeCurve({
          clipId: 'ame-ga-suki',
          lineId: '1',
          reason: 'offline',
        }),
      ),
      message(Message.ClickedRetryNativeCurve()),
      Command.resolve(
        LoadNativeCurve,
        Message.SucceededLoadNativeCurve({
          clipId: 'ame-ga-suki',
          lineId: '1',
          curve: sampleCurve,
          features: sampleFeatures,
        }),
      ),
      model(current =>
        expect(current.native).toStrictEqual(
          NativeCurve.Ready({
            clipId: 'ame-ga-suki',
            lineId: '1',
            curve: sampleCurve,
            features: sampleFeatures,
          }),
        ),
      ),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.resolve(ForgetTakeAudio, Message.CompletedForgetTakeAudio()),
      message(Message.ChangedUrl({ url: url('/line/ame-ga-suki/1') })),
      model(current => expect(current.native._tag).toBe('Ready')),
    )
  })

  test('leaving a line drops its take, finished or not, and forgets its audio', () => {
    story(
      update,
      given({
        ...on(line),
        take: Take.ShowingResult({
          takeNumber: 1,
          result: TakeResult.Tracked({
            curve: sampleCurve,
            score: sampleScore,
          }),
        }),
      }),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.expectExact(ForgetTakeAudio()),
      Command.resolve(ForgetTakeAudio, Message.CompletedForgetTakeAudio()),
      model(current => expect(current.take).toStrictEqual(Take.Idle())),
    )
  })
})
