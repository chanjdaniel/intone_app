import {
  changeFiles,
  click,
  expect,
  given,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import {
  Command,
  given as storyGiven,
  message,
  model,
  story,
} from 'foldkit/story'
import { describe, test, expect as vitestExpect } from 'vitest'

import { levelRowsPerPage } from '../../level/level'
import { FocusRow, Message, init, update, view } from './local-pack'

describe('the local pack entry', () => {
  test('shows each state of the import, and the example pack’s lines with their links', () => {
    scene(
      { update, view },
      given(init().model),
      expect(
        text('Read-out: waiting for a pack; 4 of 4 lines found'),
      ).toExist(),
      expect(role('link', { name: /^橋を渡ります/ })).toExist(),
      expect(role('link', { name: /^Line 3/ })).toExist(),
      expect(
        role('link', { name: /^Source on youtube\.com, 0:12\.5 to 0:14\.1/ }),
      ).toHaveAttr('rel', 'noopener noreferrer'),
      click(role('button', { name: 'Finding the pitch' })),
      expect(role('progressbar')).toHaveAttr('aria-valuenow', '31'),
      click(role('button', { name: 'Stop' })),
      expect(role('status')).toHaveText(
        'Stopped. Nothing of the pack was kept.',
      ),
      click(role('button', { name: 'A file missing' })),
      expect(role('alert')).toHaveText(/audio\/kyou\.wav/),
      changeFiles(selector('#pack-files'), [
        new File(['{}'], 'pack.json', { type: 'application/json' }),
      ]),
      expect(
        text(
          'Read-out: Finding the pitch of each new line: 0 of 4.; 4 of 4 lines found',
        ),
      ).toExist(),
      expect(text(/^Choices for you/)).toExist(),
    )
  })

  test('pages its lines as the app does: new words show the first page again, and Show more focuses the first new row', () => {
    story(
      update,
      storyGiven({ ...init().model, shownRows: 2 * levelRowsPerPage }),
      message(Message.ChangedWords({ words: '橋' })),
      model(current => vitestExpect(current.shownRows).toBe(levelRowsPerPage)),
      message(Message.ClickedShowMore()),
      Command.expectExact(FocusRow({ index: levelRowsPerPage })),
      Command.resolve(FocusRow, Message.CompletedFocusRow()),
    )
  })
})
