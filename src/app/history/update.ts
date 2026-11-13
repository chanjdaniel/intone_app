import { Array, Option } from 'effect'
import { Calendar, type Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import type { LineReturn } from '../returns/lineReturn'
import {
  FocusLineRow,
  LoadHistory,
  LoadLineHistory,
  ReplaceFind,
  RescoreTakes,
  rescoreBatch,
} from './commands'
import {
  type BlindPoint,
  type DayCount,
  HistoryPage,
  LineHistoryPage,
  type LineNow,
  type LineSummary,
  Rescoring,
  type ShownTake,
  type TrendPoint,
  rowsPerPage,
} from './history'

// The history screens' transitions: each screen reads the device when it
// opens, and a result for a screen no longer open changes nothing.

type HistoryUpdate = Update.Return<Model, Message, AppResourceServices>

const unchanged = (model: Model): HistoryUpdate => ({ model })

const decodeIsoDay = (day: string): Option.Option<Calendar.CalendarDate> => {
  const [year, month, date] = day.split('-').map(Number)
  return year !== undefined && month !== undefined && date !== undefined
    ? Option.some(Calendar.make(year, month, date))
    : Option.none()
}

export const openedHistory = (model: Model): HistoryUpdate => ({
  model: modifyFields(model, {
    history: page => (page._tag === 'Ready' ? page : HistoryPage.Loading()),
  }),
  commands: [LoadHistory()],
})

// The calendar opens on the month of the latest day practised, or
// today's when there is none.
export const succeededLoadHistory = (
  model: Model,
  loaded: Readonly<{
    lines: ReadonlyArray<LineSummary>
    days: ReadonlyArray<DayCount>
    today: Calendar.CalendarDate
    outdatedIds: ReadonlyArray<string>
    unreadable: number
  }>,
): HistoryUpdate => {
  const page = model.history
  if (page._tag !== 'Loading' && page._tag !== 'Ready') {
    return unchanged(model)
  }
  const latestDay = Option.flatMap(Array.last(loaded.days), ({ day }) =>
    decodeIsoDay(day),
  )
  return {
    model: modifyFields(model, {
      history: () =>
        HistoryPage.Ready({
          lines: loaded.lines,
          days: loaded.days,
          today: loaded.today,
          outdatedIds: loaded.outdatedIds,
          unreadable: loaded.unreadable,
          month:
            page._tag === 'Ready'
              ? page.month
              : Calendar.firstOfMonth(
                  Option.getOrElse(latestDay, () => loaded.today),
                ),
          shownRows: page._tag === 'Ready' ? page.shownRows : rowsPerPage,
          rescoring: page._tag === 'Ready' ? page.rescoring : Rescoring.Idle(),
        }),
    }),
  }
}

export const failedLoadHistory = (
  model: Model,
  reason: string,
): HistoryUpdate =>
  model.history._tag === 'Loading'
    ? {
        model: modifyFields(model, {
          history: () => HistoryPage.Failed({ reason }),
        }),
      }
    : unchanged(model)

const whenReady = (
  model: Model,
  change: (page: Extract<HistoryPage, { _tag: 'Ready' }>) => Readonly<{
    page: Extract<HistoryPage, { _tag: 'Ready' }>
    commands?: Update.Commands<Message, AppResourceServices>
  }>,
): HistoryUpdate => {
  if (model.history._tag !== 'Ready') {
    return unchanged(model)
  }
  const changed = change(model.history)
  return {
    model: modifyFields(model, { history: () => changed.page }),
    ...(changed.commands === undefined ? {} : { commands: changed.commands }),
  }
}

export const changedFindLines = (
  model: Model,
  words: string,
): HistoryUpdate => ({ model, commands: [ReplaceFind({ words })] })

// New words in the address show one page of the rows they find again.
export const changedFind = (model: Model): HistoryUpdate =>
  whenReady(model, page => ({
    page: modifyFields(page, { shownRows: () => rowsPerPage }),
  }))

export const clickedShowMoreLines = (model: Model): HistoryUpdate =>
  whenReady(model, page => ({
    page: modifyFields(page, { shownRows: rows => rows + rowsPerPage }),
    commands: [FocusLineRow({ index: page.shownRows })],
  }))

const monthMoved = (model: Model, months: number): HistoryUpdate =>
  whenReady(model, page => {
    const month = Calendar.addMonths(page.month, months)
    const thisMonth = Calendar.firstOfMonth(page.today)
    return {
      page: Calendar.isAfter(month, thisMonth)
        ? page
        : modifyFields(page, { month: () => month }),
    }
  })

export const clickedPreviousMonth = (model: Model): HistoryUpdate =>
  monthMoved(model, -1)

export const clickedNextMonth = (model: Model): HistoryUpdate =>
  monthMoved(model, 1)

// Scores every take scored by an earlier version again, a batch at a
// time, then reads the history again.
export const clickedRescore = (model: Model): HistoryUpdate =>
  whenReady(model, page => {
    if (
      page.rescoring._tag === 'Running' ||
      !Array.isReadonlyArrayNonEmpty(page.outdatedIds)
    ) {
      return { page }
    }
    const [batch, remainingIds] = Array.splitAt(page.outdatedIds, rescoreBatch)
    return {
      page: modifyFields(page, {
        rescoring: () =>
          Rescoring.Running({
            total: page.outdatedIds.length,
            done: 0,
            remainingIds,
          }),
      }),
      commands: [RescoreTakes({ ids: batch })],
    }
  })

export const succeededRescoreTakes = (
  model: Model,
  rescored: number,
): HistoryUpdate =>
  whenReady(model, page => {
    const rescoring = page.rescoring
    if (rescoring._tag !== 'Running') {
      return { page }
    }
    const done = rescoring.done + rescored
    if (!Array.isReadonlyArrayNonEmpty(rescoring.remainingIds)) {
      return {
        page: modifyFields(page, {
          rescoring: () => Rescoring.Done({ rescored: done }),
        }),
        commands: [LoadHistory()],
      }
    }
    const [batch, remainingIds] = Array.splitAt(
      rescoring.remainingIds,
      rescoreBatch,
    )
    return {
      page: modifyFields(page, {
        rescoring: () =>
          Rescoring.Running({ total: rescoring.total, done, remainingIds }),
      }),
      commands: [RescoreTakes({ ids: batch })],
    }
  })

export const failedRescoreTakes = (
  model: Model,
  reason: string,
): HistoryUpdate =>
  whenReady(model, page => ({
    page: modifyFields(page, {
      rescoring: () => Rescoring.Failed({ reason }),
    }),
    commands: [LoadHistory()],
  }))

// A LINE'S HISTORY

export const openedLineHistory = (
  model: Model,
  clipId: string,
  lineId: string,
): HistoryUpdate => ({
  model: modifyFields(model, {
    lineHistory: () => LineHistoryPage.Loading({ clipId, lineId }),
  }),
  commands: [LoadLineHistory({ clipId, lineId })],
})

const isLoadingLine = (model: Model, clipId: string, lineId: string) =>
  model.lineHistory._tag === 'Loading' &&
  model.lineHistory.clipId === clipId &&
  model.lineHistory.lineId === lineId

export const succeededLoadLineHistory = (
  model: Model,
  clipId: string,
  lineId: string,
  maybeFound: Option.Option<
    Readonly<{
      lineText: string
      lineNow: LineNow
      trend: ReadonlyArray<TrendPoint>
      earlierTrend: ReadonlyArray<TrendPoint>
      blindTrend: ReadonlyArray<BlindPoint>
      maybeReturn: Option.Option<LineReturn>
      today: string
      drawnFrom: 'Now' | 'Earlier'
      first: ShownTake
      maybeBest: Option.Option<ShownTake>
      latest: ShownTake
    }>
  >,
): HistoryUpdate =>
  isLoadingLine(model, clipId, lineId)
    ? {
        model: modifyFields(model, {
          lineHistory: () =>
            Option.match(maybeFound, {
              onNone: () => LineHistoryPage.Empty({ clipId, lineId }),
              onSome: found =>
                LineHistoryPage.Ready({ clipId, lineId, ...found }),
            }),
        }),
      }
    : unchanged(model)

export const failedLoadLineHistory = (
  model: Model,
  clipId: string,
  lineId: string,
  reason: string,
): HistoryUpdate =>
  isLoadingLine(model, clipId, lineId)
    ? {
        model: modifyFields(model, {
          lineHistory: () => LineHistoryPage.Failed({ clipId, lineId, reason }),
        }),
      }
    : unchanged(model)
