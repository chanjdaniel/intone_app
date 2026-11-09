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

import { sampleDue } from '../sampleReturns'
import { FocusRow, Message, init, update, view } from './due-list'

const rows = all.role('link', { name: / · last blind take / })

describe('the lines due back entry', () => {
  test('lists the sample’s lines due in the long-list frame, finds by the words typed, and shows the section with none due', () => {
    scene(
      { update, view },
      given(init().model),
      expect(text(`${sampleDue.due.length} lines due back today`)).toExist(),
      expectAll(rows).toHaveCount(sampleDue.due.length),
      type(role('searchbox', { name: 'Find a line due back' }), 'Line 1'),
      expect(
        text(
          new RegExp(
            `^\\d+ lines? of ${sampleDue.due.length} found for “Line 1”$`,
          ),
        ),
      ).toExist(),
      click(role('button', { name: 'None due' })),
      expect(
        text(
          'No lines are due back today. The next comes back on 22 December 2026.',
        ),
      ).toExist(),
    )
  })

  test('shows a page more on request, and puts focus on its first row', () => {
    scene(
      { update, view },
      given({ ...init().model, shownRows: 5 }),
      click(role('button', { name: /^Show \d+ more$/ })),
      Command.expectExact(FocusRow({ index: 5 })),
      Command.resolve(FocusRow, Message.CompletedFocusRow()),
      expectAll(rows).toHaveCount(sampleDue.due.length),
    )
  })
})
