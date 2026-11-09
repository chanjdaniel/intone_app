import { Array } from 'effect'
import { type HtmlBuilder } from 'foldkit/html'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import {
  builtEntryNames,
  indexView,
  isBuilt,
  notBuiltView,
  plannedEntries,
} from './library'

const page = (
  pageView: (h: HtmlBuilder<never>) => ReturnType<typeof indexView>,
) => ({
  update: (model: {}) => ({ model }),
  view: (_model: {}, h: HtmlBuilder<never>) => pageView(h),
})

describe('the library index', () => {
  test('lists every planned entry: a link when built, "coming" when not', () => {
    scene(
      page(indexView),
      given({}),
      expect(
        role('heading', { name: 'Component library', level: 1 }),
      ).toExist(),
      ...Array.map(plannedEntries, ({ name, title }) =>
        isBuilt(name)
          ? expect(role('link', { name: title })).toHaveAttr(
              'href',
              `/dev/${name}`,
            )
          : expect(role('link', { name: title })).toBeAbsent(),
      ),
      expect(role('link', { name: 'Tokens' })).toExist(),
      Array.every(plannedEntries, ({ name }) => isBuilt(name))
        ? expect(text('coming')).toBeAbsent()
        : expect(text('coming')).toExist(),
    )
  })

  test('every entry file is on the planned list', () => {
    const planned = Array.map(plannedEntries, ({ name }) => name)
    for (const name of builtEntryNames) {
      if (!Array.contains(planned, name)) {
        throw new Error(`./entries/${name}.ts is not in plannedEntries`)
      }
    }
  })
})

describe('an entry that is not built', () => {
  test('a planned one says it is coming', () => {
    scene(
      page(h => notBuiltView('star-row', h)),
      given({}),
      expect(role('heading', { name: 'Star row', level: 1 })).toExist(),
      expect(text('Star row is coming: its entry is not built yet.')).toExist(),
      expect(role('link', { name: 'All entries' })).toHaveAttr('href', '/dev'),
    )
  })

  test('an unknown one says the library has no such entry', () => {
    scene(
      page(h => notBuiltView('nope', h)),
      given({}),
      expect(role('heading', { name: 'No such entry', level: 1 })).toExist(),
      expect(text('The library has no entry named "nope".')).toExist(),
    )
  })
})
