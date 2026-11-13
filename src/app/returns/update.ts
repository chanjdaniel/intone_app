import { Array, type Option } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import { FocusDueRow, LoadDueLines, ReplaceDueFind } from './commands'
import { type DueLine, DuePage, dueKeyOf, dueRowsPerPage } from './returns'

// The home screen's lines due back: read each time home opens; a re-read
// that finds the same lines keeps the rows shown, and one that finds
// others goes back to one page.

type ReturnsUpdate = Update.Return<Model, Message, AppResourceServices>

export const openedDueLines = (model: Model): ReturnsUpdate => ({
  model: modifyFields(model, {
    due: page => (page._tag === 'Ready' ? page : DuePage.Loading()),
  }),
  commands: [LoadDueLines()],
})

const sameRows = (
  before: ReadonlyArray<DueLine>,
  after: ReadonlyArray<DueLine>,
): boolean =>
  Array.makeEquivalence((a: string, b: string) => a === b)(
    before.map(dueKeyOf),
    after.map(dueKeyOf),
  )

export const succeededLoadDueLines = (
  model: Model,
  today: string,
  lines: ReadonlyArray<DueLine>,
  maybeNextOn: Option.Option<string>,
): ReturnsUpdate => {
  const page = model.due
  if (page._tag !== 'Loading' && page._tag !== 'Ready') {
    return { model }
  }
  return {
    model: modifyFields(model, {
      due: () =>
        DuePage.Ready({
          today,
          lines,
          maybeNextOn,
          shownRows:
            page._tag === 'Ready' && sameRows(page.lines, lines)
              ? page.shownRows
              : dueRowsPerPage,
        }),
    }),
  }
}

export const failedLoadDueLines = (
  model: Model,
  reason: string,
): ReturnsUpdate =>
  model.due._tag === 'Loading'
    ? { model: modifyFields(model, { due: () => DuePage.Failed({ reason }) }) }
    : { model }

export const changedFindDueLines = (
  model: Model,
  words: string,
): ReturnsUpdate => ({ model, commands: [ReplaceDueFind({ words })] })

// New words in the address show one page of the rows they find again.
export const changedDueFind = (model: Model): ReturnsUpdate => {
  const page = model.due
  return page._tag === 'Ready'
    ? {
        model: modifyFields(model, {
          due: () => modifyFields(page, { shownRows: () => dueRowsPerPage }),
        }),
      }
    : { model }
}

export const clickedShowMoreDueLines = (model: Model): ReturnsUpdate => {
  const page = model.due
  return page._tag === 'Ready'
    ? {
        model: modifyFields(model, {
          due: () =>
            modifyFields(page, { shownRows: rows => rows + dueRowsPerPage }),
        }),
        commands: [FocusDueRow({ index: page.shownRows })],
      }
    : { model }
}
