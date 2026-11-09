import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, Update } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import { Dialog } from '@foldkit/ui'

import { MountDevLibrary } from './devLibrary'
import { HistoryPage, LineHistoryPage } from './history/history'
import { historyView } from './history/historyView'
import { lineHistoryView } from './history/lineHistoryView'
import * as HistoryUpdate from './history/update'
import { lineRow } from './line/lineRow'
import { type BundledLine, bundledLines, lineOf } from './line/lines'
import { NativeCurve } from './line/native'
import { practiceView } from './line/practiceView'
import * as LineUpdate from './line/update'
import { Message } from './message'
import { type Model } from './model'
import { AppRoute, homeRouter, urlToAppRoute } from './route'
import { AskToPersistStorage } from './settings/commands'
import { SettingsPage, clearDialogId } from './settings/settings'
import { settingsView } from './settings/settingsView'
import * as SettingsUpdate from './settings/update'
import { siteNav } from './siteNav'
import { ForgetTakeAudio } from './take/commands'
import { DrawCurvePair } from './take/curvePair'
import type { TakeResourceServices } from './take/resources'
import { Take } from './take/take'
import * as TakeUpdate from './take/update'

export { AppRoute } from './route'
export { Message } from './message'
export { Model } from './model'
export { managedResources } from './take/resources'
export { subscriptions } from './take/subscriptions'

// INIT

export const initialModel = (route: AppRoute): Model => ({
  route,
  maybeDevLibraryFailure: Option.none(),
  native: NativeCurve.NoLine(),
  take: Take.Idle(),
  takesStarted: 0,
  listenSpeed: 1,
  maybePlaybackFailure: Option.none(),
  history: HistoryPage.NotLoaded(),
  lineHistory: LineHistoryPage.NotLoaded(),
  settings: SettingsPage.NotLoaded(),
  maybeSettingsNotice: Option.none(),
  clearDialog: Dialog.init({ id: clearDialogId }),
})

type UpdateReturn = Update.Return<Model, Message, TakeResourceServices>

// What a screen reads when it opens: a line its native curve, unless the
// Model has it, and the history and settings screens what the device
// keeps.
const opened = (model: Model, route: AppRoute): UpdateReturn =>
  AppRoute.match<UpdateReturn>(route, {
    Line: ({ clipId, lineId }) => LineUpdate.openedLine(model, clipId, lineId),
    History: () => HistoryUpdate.openedHistory(model),
    LineHistory: ({ clipId, lineId }) =>
      HistoryUpdate.openedLineHistory(model, clipId, lineId),
    Settings: () => SettingsUpdate.openedSettings(model),
    Home: () => ({ model }),
    DevLibrary: () => ({ model }),
    DevEntry: () => ({ model }),
    NotFound: () => ({ model }),
  })

// Opening on a screen reads what it needs at once.
export const init: Runtime.RoutingApplicationInit<
  Model,
  Message,
  void,
  never,
  TakeResourceServices
> = (url: Url) => {
  const model = initialModel(urlToAppRoute(url))
  return opened(model, model.route)
}

// COMMAND

export const NavigateInternal = Command.define('NavigateInternal', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ url }) =>
    pushUrl(url).pipe(Effect.as(Message.CompletedNavigateInternal())),
})

export const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) =>
    load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

// UPDATE

// The find words of /history changed in the address, the list's screen
// staying open.
const staysOnHistory = (from: AppRoute, to: AppRoute): boolean =>
  from._tag === 'History' && to._tag === 'History'

const findOf = (route: AppRoute): string =>
  route._tag === 'History' ? Option.getOrElse(route.maybeFind, () => '') : ''

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({
          model,
          commands: [LoadExternal({ href })],
        }),
      }),

    ChangedUrl: ({ url }) => {
      const route = urlToAppRoute(url)
      const routed = modifyFields(model, {
        route: () => route,
        maybeDevLibraryFailure: () => Option.none(),
      })
      const leftLine =
        model.route._tag === 'Line' &&
        !(
          route._tag === 'Line' &&
          route.clipId === model.route.clipId &&
          route.lineId === model.route.lineId
        )
      const left = leftLine ? TakeUpdate.leftLine(routed) : routed
      const arrived = staysOnHistory(model.route, route)
        ? findOf(model.route) === findOf(route)
          ? { model: left }
          : HistoryUpdate.changedFind(left)
        : opened(left, route)
      return leftLine
        ? {
            model: arrived.model,
            commands: [...(arrived.commands ?? []), ForgetTakeAudio()],
          }
        : arrived
    },

    CompletedNavigateInternal: () => ({ model }),
    CompletedLoadExternal: () => ({ model }),
    CompletedMountDevLibrary: () => ({ model }),

    FailedMountDevLibrary: ({ reason }) => ({
      model: modifyFields(model, {
        maybeDevLibraryFailure: () => Option.some(reason),
      }),
    }),

    SucceededLoadNativeCurve: ({ clipId, lineId, curve, features }) =>
      LineUpdate.succeededLoadNativeCurve(
        model,
        clipId,
        lineId,
        curve,
        features,
      ),
    FailedLoadNativeCurve: ({ clipId, lineId, reason }) =>
      LineUpdate.failedLoadNativeCurve(model, clipId, lineId, reason),
    ClickedRetryNativeCurve: () => LineUpdate.clickedRetryNativeCurve(model),
    ClickedListen: ({ voice, extent }) =>
      TakeUpdate.clickedListen(model, voice, extent),
    ClickedStopListening: () => TakeUpdate.clickedStopListening(model),
    EndedListening: ({ voice, extent }) =>
      TakeUpdate.endedListening(model, voice, extent),
    SelectedListenSpeed: ({ speed }) => ({
      model: modifyFields(model, { listenSpeed: () => speed }),
    }),
    FailedPlayback: ({ reason }) => TakeUpdate.failedPlayback(model, reason),
    CompletedForgetTakeAudio: () => ({ model }),

    ClickedRecord: () => TakeUpdate.clickedRecord(model),
    EndedNativeBeforeTake: ({ takeNumber }) =>
      TakeUpdate.endedNativeBeforeTake(model, takeNumber),
    ClickedStop: () => TakeUpdate.clickedStop(model),
    ClickedCancelTake: () => TakeUpdate.clickedCancelTake(model),
    AcquiredTracker: () => TakeUpdate.acquiredTracker(model),
    FailedAcquireTracker: ({ reason }) =>
      TakeUpdate.failedAcquireTracker(model, reason),
    ReleasedTracker: () => ({ model }),
    AcquiredMicrophone: () => TakeUpdate.acquiredMicrophone(model),
    FailedAcquireMicrophone: ({ failure, reason }) =>
      TakeUpdate.failedAcquireMicrophone(model, failure, reason),
    ReleasedMicrophone: () => ({ model }),
    CompletedWaitForMicAnswer: ({ takeNumber }) =>
      TakeUpdate.completedWaitForMicAnswer(model, takeNumber),
    TickedTakeMeter: ({ takeNumber, elapsedSeconds, levelDb }) =>
      TakeUpdate.tickedTakeMeter(model, takeNumber, elapsedSeconds, levelDb),
    DetectedVoiceOnset: ({ takeNumber, onsetSeconds }) =>
      TakeUpdate.detectedVoiceOnset(model, takeNumber, onsetSeconds),
    FailedRecordTake: ({ takeNumber, reason }) =>
      TakeUpdate.failedRecordTake(model, takeNumber, reason),
    SucceededAnalyseTake: ({ takeNumber, result }) =>
      TakeUpdate.succeededAnalyseTake(model, takeNumber, result),
    FailedAnalyseTake: ({ takeNumber, reason }) =>
      TakeUpdate.failedAnalyseTake(model, takeNumber, reason),
    CompletedFocusTakeControl: () => ({ model }),
    CompletedDrawCurvePair: () => ({ model }),
    CompletedAskToPersistStorage: ({ storage }) =>
      SettingsUpdate.completedAskToPersistStorage(model, storage),

    SucceededLoadHistory: loaded =>
      HistoryUpdate.succeededLoadHistory(model, loaded),
    FailedLoadHistory: ({ reason }) =>
      HistoryUpdate.failedLoadHistory(model, reason),
    ChangedFindLines: ({ words }) =>
      HistoryUpdate.changedFindLines(model, words),
    CompletedReplaceFind: () => ({ model }),
    ClickedShowMoreLines: () => HistoryUpdate.clickedShowMoreLines(model),
    CompletedFocusLineRow: () => ({ model }),
    ClickedPreviousMonth: () => HistoryUpdate.clickedPreviousMonth(model),
    ClickedNextMonth: () => HistoryUpdate.clickedNextMonth(model),
    ClickedRescore: () => HistoryUpdate.clickedRescore(model),
    SucceededRescoreTakes: ({ rescored }) =>
      HistoryUpdate.succeededRescoreTakes(model, rescored),
    FailedRescoreTakes: ({ reason }) =>
      HistoryUpdate.failedRescoreTakes(model, reason),
    SucceededLoadLineHistory: ({ clipId, lineId, maybeFound }) =>
      HistoryUpdate.succeededLoadLineHistory(model, clipId, lineId, maybeFound),
    FailedLoadLineHistory: ({ clipId, lineId, reason }) =>
      HistoryUpdate.failedLoadLineHistory(model, clipId, lineId, reason),

    SucceededLoadSettings: ({ facts }) =>
      SettingsUpdate.succeededLoadSettings(model, facts),
    FailedLoadSettings: ({ reason }) =>
      SettingsUpdate.failedLoadSettings(model, reason),
    ToggledKeepTakeAudio: ({ keep }) =>
      SettingsUpdate.toggledKeepTakeAudio(model, keep),
    SucceededSetKeepTakeAudio: () => ({ model }),
    FailedSetKeepTakeAudio: ({ reason }) =>
      SettingsUpdate.failedSetKeepTakeAudio(model, reason),
    ClickedAskToPersistStorage: () => ({
      model,
      commands: [AskToPersistStorage()],
    }),
    ToggledBackupAudio: ({ include }) =>
      SettingsUpdate.toggledBackupAudio(model, include),
    ClickedSaveBackup: () => SettingsUpdate.clickedSaveBackup(model),
    SucceededSaveBackup: ({ fileName, takes }) =>
      SettingsUpdate.succeededSaveBackup(model, fileName, takes),
    FailedSaveBackup: ({ reason }) =>
      SettingsUpdate.failedSaveBackup(model, reason),
    ClickedRestoreBackup: () => SettingsUpdate.clickedRestoreBackup(model),
    SucceededRestoreBackup: ({ takes }) =>
      SettingsUpdate.succeededRestoreBackup(model, takes),
    CancelledRestoreBackup: () => SettingsUpdate.cancelledRestoreBackup(model),
    FailedRestoreBackup: ({ reason }) =>
      SettingsUpdate.failedRestoreBackup(model, reason),
    ClickedClearAll: () => SettingsUpdate.clickedClearAll(model),
    GotClearDialogMessage: ({ message }) =>
      SettingsUpdate.foldClearDialog(model, message),
    ClickedKeepEverything: () => SettingsUpdate.clickedKeepEverything(model),
    SubmittedClearAll: () => SettingsUpdate.submittedClearAll(model),
    SucceededClearAllData: () => SettingsUpdate.succeededClearAllData(model),
    FailedClearAllData: ({ reason }) =>
      SettingsUpdate.failedClearAllData(model, reason),
  })

// VIEW

export const tagline =
  'Practise Japanese pitch accent by copying native speakers, line by line, on your own device.'

const homeView = (
  lines: ReadonlyArray<BundledLine>,
  h: HtmlBuilder<Message>,
): Html =>
  h.main(
    [h.Class('min-h-screen bg-surface text-ink px-4 py-10 sm:px-6 sm:py-16')],
    [
      h.div(
        [h.Class('mx-auto flex max-w-2xl flex-col gap-10')],
        [
          siteNav('Lines', h),
          h.header(
            [h.Class('flex flex-col gap-3 text-center')],
            [
              h.h1([h.Class('text-5xl font-bold tracking-tight')], ['Intone']),
              h.p([h.Class('mx-auto max-w-md text-lg text-muted')], [tagline]),
            ],
          ),
          h.section(
            [h.AriaLabelledBy('lines-heading'), h.Class('flex flex-col gap-4')],
            [
              h.h2(
                [h.Id('lines-heading'), h.Class('text-xl font-bold')],
                ['Lines to copy'],
              ),
              h.ul(
                [h.Class('flex flex-col gap-3')],
                lines.map(line =>
                  h.keyed('li')(
                    `${line.clipId}/${line.lineId}`,
                    [],
                    [lineRow(line, h)],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    ],
  )

const lineView = (model: Model, line: BundledLine, h: HtmlBuilder<Message>) =>
  practiceView(
    line,
    {
      native: model.native,
      take: model.take,
      speed: model.listenSpeed,
      canPlayLine: TakeUpdate.canListenTo(model, 'Line'),
      canPlayTake: TakeUpdate.canListenTo(model, 'Take'),
      maybePlaybackFailure: model.maybePlaybackFailure,
    },
    {
      record: Message.ClickedRecord(),
      stop: Message.ClickedStop(),
      cancel: Message.ClickedCancelTake(),
      retryNative: Message.ClickedRetryNativeCurve(),
      listen: (voice, extent) => Message.ClickedListen({ voice, extent }),
      stopListening: Message.ClickedStopListening(),
      selectSpeed: speed => Message.SelectedListenSpeed({ speed }),
      draw: DrawCurvePair,
    },
    h,
  )

const notFoundView = (path: string, h: HtmlBuilder<Message>): Html =>
  h.main(
    [
      h.Class(
        'min-h-screen bg-surface text-ink flex flex-col items-center justify-center gap-4 px-6 py-12 text-center',
      ),
    ],
    [
      h.h1([h.Class('text-3xl font-bold')], ['Nothing here']),
      h.p(
        [h.Class('max-w-md text-base text-muted break-all')],
        [`The app has no page at ${path}.`],
      ),
      h.a(
        [
          h.Href(homeRouter()),
          h.Class(
            'inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          ),
        ],
        ['Go to the start'],
      ),
    ],
  )

const devLibraryView = (
  maybeEntry: Option.Option<string>,
  maybeFailure: Option.Option<string>,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(maybeFailure, {
    onSome: reason =>
      h.main(
        [h.Class('min-h-screen bg-surface text-ink p-6')],
        [
          h.p(
            [h.Role('alert'), h.Class('text-bad')],
            [`The component library did not load: ${reason}`],
          ),
        ],
      ),
    // NOTE: a Mount's args are read once, when its element enters the
    // DOM, so the host is keyed by the entry it opens: moving between
    // entries replaces the element and opens the next one.
    onNone: () =>
      h.keyed('div')(
        Option.getOrElse(maybeEntry, () => ''),
        [h.OnMount(MountDevLibrary({ maybeEntry }))],
      ),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Intone',
  body: AppRoute.match(model.route, {
    Home: () => homeView(bundledLines, h),
    Line: ({ clipId, lineId }) =>
      Option.match(lineOf(clipId, lineId), {
        onNone: () => notFoundView(`/line/${clipId}/${lineId}`, h),
        onSome: line => lineView(model, line, h),
      }),
    DevLibrary: () =>
      devLibraryView(Option.none(), model.maybeDevLibraryFailure, h),
    DevEntry: ({ entry }) =>
      devLibraryView(Option.some(entry), model.maybeDevLibraryFailure, h),
    History: ({ maybeFind }) =>
      historyView(
        model.history,
        maybeFind,
        {
          previousMonth: Message.ClickedPreviousMonth(),
          nextMonth: Message.ClickedNextMonth(),
          changedWords: words => Message.ChangedFindLines({ words }),
          showMore: Message.ClickedShowMoreLines(),
          rescore: Message.ClickedRescore(),
        },
        h,
      ),
    LineHistory: () =>
      lineHistoryView(model.lineHistory, { draw: DrawCurvePair }, h),
    Settings: () =>
      settingsView(
        model.settings,
        model.maybeSettingsNotice,
        model.clearDialog,
        {
          keepTakeAudio: keep => Message.ToggledKeepTakeAudio({ keep }),
          askToPersist: Message.ClickedAskToPersistStorage(),
          includeAudio: include => Message.ToggledBackupAudio({ include }),
          saveBackup: Message.ClickedSaveBackup(),
          restoreBackup: Message.ClickedRestoreBackup(),
          clearAll: Message.ClickedClearAll(),
          keepEverything: Message.ClickedKeepEverything(),
          confirmClearAll: Message.SubmittedClearAll(),
          dialog: message => Message.GotClearDialogMessage({ message }),
        },
        h,
      ),
    NotFound: ({ path }) => notFoundView(path, h),
  }),
})
