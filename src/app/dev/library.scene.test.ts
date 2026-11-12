import { Array, Order } from 'effect'
import { type HtmlBuilder } from 'foldkit/html'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { describe, expect as expect_, test } from 'vitest'

import {
  builtEntryNames,
  indexView,
  libraryEntries,
  noEntryView,
} from './library'

const page = (
  pageView: (h: HtmlBuilder<never>) => ReturnType<typeof indexView>,
) => ({
  update: (model: {}) => ({ model }),
  view: (_model: {}, h: HtmlBuilder<never>) => pageView(h),
})

describe('the library index', () => {
  test('links every entry by its title', () => {
    scene(
      page(indexView),
      given({}),
      expect(
        role('heading', { name: 'Component library', level: 1 }),
      ).toExist(),
      ...Array.map(libraryEntries, ({ name, title }) =>
        expect(role('link', { name: title })).toHaveAttr(
          'href',
          `/dev/${name}`,
        ),
      ),
    )
  })

  test('lists every entry file, and has a file for every entry it lists', () => {
    const listed = Array.map(libraryEntries, ({ name }) => name)
    expect_(Array.sort(builtEntryNames, Order.String)).toStrictEqual(
      Array.sort(listed, Order.String),
    )
  })
})

describe('an address with no entry', () => {
  test('says the library has no such entry', () => {
    scene(
      page(h => noEntryView('nope', h)),
      given({}),
      expect(role('heading', { name: 'No such entry', level: 1 })).toExist(),
      expect(text('The library has no entry named "nope".')).toExist(),
      expect(role('link', { name: 'All entries' })).toHaveAttr('href', '/dev'),
    )
  })
})
