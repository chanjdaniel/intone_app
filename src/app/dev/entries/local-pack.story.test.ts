import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { levelRowsPerPage } from '../../level/level'
import { FocusRow, Message, init, update } from './local-pack'

describe('the local pack entry', () => {
  test('pages its lines as the app does: new words show the first page again, and Show more focuses the first new row', () => {
    story(
      update,
      given({ ...init().model, shownRows: 2 * levelRowsPerPage }),
      message(Message.ChangedWords({ words: '橋' })),
      model(current => expect(current.shownRows).toBe(levelRowsPerPage)),
      message(Message.ClickedShowMore()),
      Command.expectExact(FocusRow({ index: levelRowsPerPage })),
      Command.resolve(FocusRow, Message.CompletedFocusRow()),
    )
  })
})
