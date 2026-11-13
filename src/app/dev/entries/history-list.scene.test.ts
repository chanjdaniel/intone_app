import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  text,
  type,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { FocusRow, Message, init, update, view } from './history-list'

const rows = all.role('link', { name: / · last / })

describe('the history list entry', () => {
  test('shows 50 of the 200 lines, a page more on request, and finds by the words typed', () => {
    scene(
      { update, view },
      given(init().model),
      expect(text('200 lines practised')).toExist(),
      expectAll(rows).toHaveCount(50),
      click(role('button', { name: 'Show 50 more' })),
      Command.expectExact(FocusRow({ index: 50 })),
      Command.resolve(FocusRow, Message.CompletedFocusRow()),
      expectAll(rows).toHaveCount(100),
      type(role('searchbox', { name: 'Find a line' }), '雨が好き 1'),
      expect(text(/^\d+ lines? of 200 found for “雨が好き 1”$/)).toExist(),
      expect(role('button', { name: /^Show \d+ more$/ })).toBeAbsent(),
    )
  })
})
