import { Option } from 'effect'
import { Mount, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { MountDevLibrary } from './devLibrary'
import { AppRoute, Message, type Model, tagline, update, view } from './main'
import { Take } from './take/take'

const on = (route: AppRoute): Model => ({
  route,
  maybeDevLibraryFailure: Option.none(),
  take: Take.Idle(),
  takesStarted: 0,
})

describe('home screen', () => {
  test('names the app in its one top-level heading and says what it is for', () => {
    scene(
      { update, view },
      given(on(AppRoute.Home())),
      expect(role('heading', { name: 'Intone', level: 1 })).toExist(),
      expect(text(tagline)).toExist(),
    )
  })
})

describe('not-found screen', () => {
  test('names the address and links back to the start', () => {
    scene(
      { update, view },
      given(on(AppRoute.NotFound({ path: '/nowhere' }))),
      expect(role('heading', { name: 'Nothing here', level: 1 })).toExist(),
      expect(text('The app has no page at /nowhere.')).toExist(),
      expect(role('link', { name: 'Go to the start' })).toHaveAttr('href', '/'),
    )
  })
})

describe('component library', () => {
  test('opens the library in a host of its own', () => {
    scene(
      { update, view },
      given(on(AppRoute.DevEntry({ entry: 'tokens' }))),
      Mount.expectHas(MountDevLibrary),
      Mount.resolve(MountDevLibrary, Message.CompletedMountDevLibrary()),
    )
  })

  test('says why when the library did not load', () => {
    scene(
      { update, view },
      given({
        route: AppRoute.DevLibrary(),
        maybeDevLibraryFailure: Option.some('offline'),
      }),
      expect(role('alert')).toHaveText(
        'The component library did not load: offline',
      ),
      Mount.expectNone(),
    )
  })
})
