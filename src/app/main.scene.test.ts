import { Option } from 'effect'
import { Mount, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { MountDevLibrary } from './devLibrary'
import { NativeCurve } from './line/native'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  tagline,
  update,
  view,
} from './main'

const on = (route: AppRoute): Model => initialModel(route)

describe('home screen', () => {
  test('names the app in its one top-level heading and says what it is for', () => {
    scene(
      { update, view },
      given(on(AppRoute.Home({ maybeFind: Option.none() }))),
      expect(role('heading', { name: 'Intone', level: 1 })).toExist(),
      expect(text(tagline)).toExist(),
    )
  })
})

describe('home screen lines', () => {
  test('lists the bundled line, linked to its practice screen', () => {
    scene(
      { update, view },
      given(on(AppRoute.Home({ maybeFind: Option.none() }))),
      expect(role('heading', { name: 'Lines to copy', level: 2 })).toExist(),
      expect(role('link', { name: 'Copy 雨が好き, あめがすき' })).toHaveAttr(
        'href',
        '/line/ame-ga-suki/1',
      ),
    )
  })

  test('a line the device does not have is not found', () => {
    scene(
      { update, view },
      given({
        ...on(AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '9' })),
        native: NativeCurve.Failed({
          clipId: 'ame-ga-suki',
          lineId: '9',
          failure: 'NoSuchLine',
          reason: 'There is no such line on this device.',
        }),
      }),
      expect(text('The app has no page at /line/ame-ga-suki/9.')).toExist(),
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
