import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import {
  AppRoute,
  Message,
  type Model,
  NavigateInternal,
  init,
  update,
} from './main'
import { Take } from './take/take'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const on = (route: AppRoute): Model => ({
  route,
  maybeDevLibraryFailure: Option.none(),
  take: Take.Idle(),
  takesStarted: 0,
})

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
