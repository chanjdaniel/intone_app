import { Array, Effect, Option, Schema } from 'effect'
import { Command, Runtime, Subscription, Update } from 'foldkit'
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
import { clipRow } from './level/clipRow'
import { FollowLineEditorPointer } from './level/editorPointer'
import * as EditorUpdate from './level/editorUpdate'
import { ClipsPage, LevelPage, deleteClipDialogId } from './level/level'
import { levelView } from './level/levelView'
import { levelSubscriptions } from './level/subscriptions'
import * as LevelUpdate from './level/update'
import { lineRow } from './line/lineRow'
import {
  type BundledLine,
  bundledLines,
  lineOf,
  practiceLineOfBundled,
} from './line/lines'
import { NativeCurve } from './line/native'
import { LinePlace } from './line/place'
import { practiceView } from './line/practiceView'
import * as LineUpdate from './line/update'
import { Message } from './message'
import { type Model } from './model'
import { pageFrame } from './pageFrame'
import type { AppResourceServices } from './resources'
import { dueSection } from './returns/dueList'
import { DuePage } from './returns/returns'
import * as ReturnsUpdate from './returns/update'
import { AppRoute, homeRouter, uploadRouter, urlToAppRoute } from './route'
import { AskToPersistStorage } from './settings/commands'
import { SettingsPage, clearDialogId } from './settings/settings'
import { settingsView } from './settings/settingsView'
import * as SettingsUpdate from './settings/update'
import { ForgetTakeAudio } from './take/commands'
import { DrawCurvePair } from './take/curvePair'
import { subscriptions as takeSubscriptions } from './take/subscriptions'
import { Take } from './take/take'
import * as TakeUpdate from './take/update'
import * as PackUpdate from './upload/packUpdate'
import { uploadSubscriptions } from './upload/subscriptions'
import * as UploadUpdate from './upload/update'
import { initialUpload } from './upload/upload'
import { uploadView } from './upload/uploadView'

export { AppRoute } from './route'
export { Message } from './message'
export { Model } from './model'
export { managedResources } from './resources'

export const subscriptions = Subscription.aggregate(
  takeSubscriptions,
  uploadSubscriptions,
  levelSubscriptions,
)

// INIT

export const initialModel = (route: AppRoute): Model => ({
  route,
  maybeDevLibraryFailure: Option.none(),
  native: NativeCurve.NoLine(),
  place: LinePlace.NotLoaded(),
  take: Take.Idle(),
  takesStarted: 0,
  listenSpeed: 1,
  maybePlaybackFailure: Option.none(),
  history: HistoryPage.NotLoaded(),
  lineHistory: LineHistoryPage.NotLoaded(),
  settings: SettingsPage.NotLoaded(),
  maybeSettingsNotice: Option.none(),
  clearDialog: Dialog.init({ id: clearDialogId }),
  upload: initialUpload,
  clips: ClipsPage.NotLoaded(),
  due: DuePage.NotLoaded(),
  level: LevelPage.NotLoaded(),
  deleteClipDialog: Dialog.init({ id: deleteClipDialogId }),
  maybeHomeNotice: Option.none(),
})

type UpdateReturn = Update.Return<Model, Message, AppResourceServices>

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
    Home: () =>
      Update.combine(model, [
        LevelUpdate.openedHome,
        ReturnsUpdate.openedDueLines,
      ]),
    Upload: () => ({ model }),
    Level: ({ clipId }) => LevelUpdate.openedLevel(model, clipId),
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
  AppResourceServices
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

const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) =>
    load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

// UPDATE

// The find words of /history or of a clip's lines changed in the
// address, the list's screen staying open.
const staysOnList = (from: AppRoute, to: AppRoute): boolean =>
  (from._tag === 'Home' && to._tag === 'Home') ||
  (from._tag === 'History' && to._tag === 'History') ||
  (from._tag === 'Level' && to._tag === 'Level' && from.clipId === to.clipId)

const findOf = (route: AppRoute): string =>
  route._tag === 'Home' || route._tag === 'History' || route._tag === 'Level'
    ? Option.getOrElse(route.maybeFind, () => '')
    : ''

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
      const leftUpload =
        model.route._tag === 'Upload' && route._tag !== 'Upload'
          ? PackUpdate.leftPackImport(UploadUpdate.leftUpload(routed))
          : routed
      const leftHome =
        route._tag === 'Home'
          ? leftUpload
          : modifyFields(leftUpload, { maybeHomeNotice: () => Option.none() })
      const left = leftLine ? TakeUpdate.leftLine(leftHome) : leftHome
      const arrived = staysOnList(model.route, route)
        ? findOf(model.route) === findOf(route)
          ? { model: left }
          : route._tag === 'Level'
            ? LevelUpdate.changedLevelFind(left)
            : route._tag === 'Home'
              ? ReturnsUpdate.changedDueFind(left)
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

    SucceededLoadNativeCurve: ({ clipId, lineId, line, curve, features }) =>
      LineUpdate.succeededLoadNativeCurve(
        model,
        clipId,
        lineId,
        line,
        curve,
        features,
      ),
    FailedLoadNativeCurve: ({ clipId, lineId, failure, reason }) =>
      LineUpdate.failedLoadNativeCurve(model, clipId, lineId, failure, reason),
    ClickedRetryNativeCurve: () => LineUpdate.clickedRetryNativeCurve(model),
    SucceededLoadLinePlace: ({ _tag, ...found }) =>
      LineUpdate.succeededLoadLinePlace(model, found),
    FailedLoadLinePlace: ({ clipId, lineId, reason }) =>
      LineUpdate.failedLoadLinePlace(model, clipId, lineId, reason),
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

    GotUploadDropMessage: ({ message }) =>
      UploadUpdate.foldUploadDrop(model, message),
    ProgressedUpload: ({ jobNumber, step }) =>
      UploadUpdate.progressedUpload(model, jobNumber, step),
    SucceededUpload: ({ jobNumber, clipId }) =>
      UploadUpdate.succeededUpload(model, jobNumber, clipId),
    FailedUpload: ({ jobNumber, reason }) =>
      UploadUpdate.failedUpload(model, jobNumber, reason),
    ClickedCancelUpload: () => UploadUpdate.clickedCancelUpload(model),
    GotPackDropMessage: ({ message }) =>
      PackUpdate.foldPackDrop(model, message),
    GotPackFolderMessage: ({ message }) =>
      PackUpdate.foldPackFolder(model, message),
    ProgressedPackImport: ({ jobNumber, step }) =>
      PackUpdate.progressedPackImport(model, jobNumber, step),
    SucceededPackImport: ({ jobNumber, clipId }) =>
      PackUpdate.succeededPackImport(model, jobNumber, clipId),
    FailedPackImport: ({ jobNumber, reason }) =>
      PackUpdate.failedPackImport(model, jobNumber, reason),
    ClickedCancelPackImport: () => PackUpdate.clickedCancelPackImport(model),
    CompletedOpenLevel: () => ({ model }),
    CompletedFocusUploadStatus: () => ({ model }),

    SucceededLoadDueLines: ({ today, lines, maybeNextOn }) =>
      ReturnsUpdate.succeededLoadDueLines(model, today, lines, maybeNextOn),
    FailedLoadDueLines: ({ reason }) =>
      ReturnsUpdate.failedLoadDueLines(model, reason),
    ChangedFindDueLines: ({ words }) =>
      ReturnsUpdate.changedFindDueLines(model, words),
    CompletedReplaceDueFind: () => ({ model }),
    ClickedShowMoreDueLines: () => ReturnsUpdate.clickedShowMoreDueLines(model),
    CompletedFocusDueRow: () => ({ model }),

    SucceededLoadClips: ({ clips }) =>
      LevelUpdate.succeededLoadClips(model, clips),
    FailedLoadClips: ({ reason }) => LevelUpdate.failedLoadClips(model, reason),
    SucceededLoadLevel: ({ clipId, maybeClip }) =>
      LevelUpdate.succeededLoadLevel(model, clipId, maybeClip),
    FailedLoadLevel: ({ clipId, reason }) =>
      LevelUpdate.failedLoadLevel(model, clipId, reason),
    SucceededLoadLevelStars: ({ clipId, lines }) =>
      LevelUpdate.succeededLoadLevelStars(model, clipId, lines),
    FailedLoadLevelStars: ({ clipId, reason }) =>
      LevelUpdate.failedLoadLevelStars(model, clipId, reason),
    ChangedFindLevelLines: ({ words }) =>
      LevelUpdate.changedFindLevelLines(model, words),
    CompletedReplaceLevelFind: () => ({ model }),
    ClickedShowMoreLevelLines: () =>
      LevelUpdate.clickedShowMoreLevelLines(model),
    CompletedFocusLevelRow: () => ({ model }),
    ClickedDeleteClip: () => LevelUpdate.clickedDeleteClip(model),
    GotDeleteClipDialogMessage: ({ message }) =>
      LevelUpdate.foldDeleteClipDialog(model, message),
    ClickedKeepClip: () => LevelUpdate.clickedKeepClip(model),
    SubmittedDeleteClip: () => LevelUpdate.submittedDeleteClip(model),
    SucceededDeleteClip: ({ clipId, name }) =>
      LevelUpdate.succeededDeleteClip(model, clipId, name),
    FailedDeleteClip: ({ clipId, reason }) =>
      LevelUpdate.failedDeleteClip(model, clipId, reason),
    CompletedGoHome: () => ({ model }),

    AcquiredClipEditor: ({ clipId, peaks }) =>
      EditorUpdate.acquiredClipEditor(model, clipId, peaks),
    FailedAcquireClipEditor: ({ reason }) =>
      EditorUpdate.failedAcquireClipEditor(model, reason),
    ReleasedClipEditor: () => EditorUpdate.releasedClipEditor(model),
    SelectedLevelLine: ({ lineId }) =>
      EditorUpdate.selectedLevelLine(model, lineId, false),
    ClickedEditLevelLine: ({ lineId }) =>
      EditorUpdate.selectedLevelLine(model, lineId, true),
    ClickedOpenLineEditor: () => EditorUpdate.clickedOpenLineEditor(model),
    ClickedPlayLevelLine: () => EditorUpdate.clickedPlayLevelLine(model),
    ClickedStopLevelLine: () => EditorUpdate.clickedStopLevelLine(model),
    MovedLevelPlayhead: ({ playNumber, seconds }) =>
      EditorUpdate.movedLevelPlayhead(model, playNumber, seconds),
    EndedLevelPlayback: ({ playNumber }) =>
      EditorUpdate.endedLevelPlayback(model, playNumber),
    FailedLevelPlayback: ({ playNumber, reason }) =>
      EditorUpdate.failedLevelPlayback(model, playNumber, reason),
    PlacedLevelPlayhead: ({ seconds }) =>
      EditorUpdate.placedLevelPlayhead(model, seconds),
    MovedLineEdge: ({ lineId, edge, seconds }) =>
      EditorUpdate.movedLineEdge(model, lineId, edge, seconds, 'Pointer'),
    SteppedLineEdge: ({ lineId, edge, step }) =>
      EditorUpdate.steppedLineEdge(model, lineId, edge, step),
    SteppedLevelPlayhead: ({ step }) =>
      EditorUpdate.steppedLevelPlayhead(model, step),
    ReleasedLineEdge: () => EditorUpdate.releasedLineEdge(model),
    CompletedWaitForKeysToRest: ({ draftNumber }) =>
      EditorUpdate.completedWaitForKeysToRest(model, draftNumber),
    ClickedSplitLine: () => EditorUpdate.clickedSplitLine(model),
    ClickedMergeLines: ({ lineId }) =>
      EditorUpdate.clickedMergeLines(model, lineId),
    ClickedDeleteLine: () => EditorUpdate.clickedDeleteLine(model),
    ClickedUndoLineChange: () => EditorUpdate.clickedUndoLineChange(model),
    SucceededEditClipLines: ({ clipId, clip }) =>
      EditorUpdate.succeededEditClipLines(model, clipId, clip),
    FailedEditClipLines: ({ clipId, reason }) =>
      EditorUpdate.failedEditClipLines(model, clipId, reason),
    // An undo lands as a change does.
    SucceededUndoClipLineChange: ({ clipId, clip }) =>
      EditorUpdate.succeededEditClipLines(model, clipId, clip),
    FailedUndoClipLineChange: ({ clipId, reason }) =>
      EditorUpdate.failedEditClipLines(model, clipId, reason),
    CompletedFocusLineEditor: () => ({ model }),
    CompletedFollowLineEditorPointer: () => ({ model }),

    ClickedRecord: () => TakeUpdate.clickedRecord(model, 'Guided'),
    ClickedRecordBlind: () => TakeUpdate.clickedRecord(model, 'Blind'),
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
    CompletedRestoreBackup: () => SettingsUpdate.completedRestoreBackup(model),
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

// The learner's own clips on the home screen, newest first, and the way to
// bring another.
// The home page's secondary buttons, in the accent's colour.
const secondaryButton =
  'button border border-line bg-surface text-accent hover:border-accent'

const clipsSection = (clips: ClipsPage, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabelledBy('clips-heading'), h.Class('flex flex-col gap-4')],
    [
      h.h2(
        [h.Id('clips-heading'), h.Class('text-xl font-bold')],
        ['Your own clips'],
      ),
      ClipsPage.match(clips, {
        NotLoaded: () => h.empty,
        Loading: () => h.empty,
        Failed: ({ reason }) =>
          h.p(
            [h.Role('alert'), h.Class('text-base text-bad break-words')],
            [`Your clips could not be read. ${reason}`],
          ),
        Ready: ({ clips: ready }) =>
          Array.match(ready, {
            onEmpty: () =>
              h.p(
                [h.Class('text-base text-muted')],
                [
                  'Bring a recording of Japanese speech, and copy it line by line.',
                ],
              ),
            onNonEmpty: some =>
              h.ul(
                [h.Class('flex flex-col gap-3')],
                some.map(clip =>
                  h.keyed('li')(clip.id, [], [clipRow(clip, h)]),
                ),
              ),
          }),
      }),
      h.a(
        [h.Href(uploadRouter()), h.Class(`${secondaryButton} self-start`)],
        ['Bring your own audio'],
      ),
    ],
  )

const homeView = (
  lines: ReadonlyArray<BundledLine>,
  clips: ClipsPage,
  due: DuePage,
  words: string,
  maybeNotice: Option.Option<string>,
  h: HtmlBuilder<Message>,
): Html =>
  pageFrame(
    'Lines',
    [
      h.header(
        [h.Class('flex flex-col gap-3 text-center')],
        [
          h.h1([h.Class('text-5xl font-bold tracking-tight')], ['Intone']),
          h.p([h.Class('mx-auto max-w-md text-lg text-muted')], [tagline]),
        ],
      ),
      h.p(
        [
          h.Role('status'),
          h.Class(
            'rounded-lg border border-good bg-surface p-4 text-base text-ink break-words empty:hidden',
          ),
        ],
        [Option.getOrElse(maybeNotice, () => '')],
      ),
      dueSection(
        due,
        words,
        {
          changedWords: words => Message.ChangedFindDueLines({ words }),
          showMore: Message.ClickedShowMoreDueLines(),
        },
        secondaryButton,
        h,
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
      clipsSection(clips, h),
    ],
    h,
    'gap-10',
  )

const lineView = (
  model: Model,
  clipId: string,
  lineId: string,
  h: HtmlBuilder<Message>,
) =>
  practiceView(
    clipId,
    lineId,
    model.native._tag === 'Ready' &&
      model.native.clipId === clipId &&
      model.native.lineId === lineId
      ? Option.some(model.native.line)
      : Option.map(lineOf(clipId, lineId), practiceLineOfBundled),
    {
      native: model.native,
      place: model.place,
      take: model.take,
      speed: model.listenSpeed,
      canPlayLine: TakeUpdate.canListenTo(model, 'Line'),
      canPlayTake: TakeUpdate.canListenTo(model, 'Take'),
      maybePlaybackFailure: model.maybePlaybackFailure,
    },
    {
      record: Message.ClickedRecord(),
      recordBlind: Message.ClickedRecordBlind(),
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
          h.Href(homeRouter({ maybeFind: Option.none() })),
          h.Class(
            'inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4 focus-ring',
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
    Home: ({ maybeFind }) =>
      homeView(
        bundledLines,
        model.clips,
        model.due,
        Option.getOrElse(maybeFind, () => ''),
        model.maybeHomeNotice,
        h,
      ),
    Line: ({ clipId, lineId }) =>
      model.native._tag === 'Failed' &&
      model.native.failure === 'NoSuchLine' &&
      model.native.clipId === clipId &&
      model.native.lineId === lineId
        ? notFoundView(`/line/${clipId}/${lineId}`, h)
        : lineView(model, clipId, lineId, h),
    Upload: () =>
      uploadView(
        model.upload,
        {
          fileDrop: message => Message.GotUploadDropMessage({ message }),
          cancel: Message.ClickedCancelUpload(),
          packDrop: message => Message.GotPackDropMessage({ message }),
          packFolder: message => Message.GotPackFolderMessage({ message }),
          cancelPack: Message.ClickedCancelPackImport(),
        },
        h,
      ),
    Level: ({ maybeFind }) =>
      levelView(
        model.level,
        maybeFind,
        model.deleteClipDialog,
        {
          changedWords: words => Message.ChangedFindLevelLines({ words }),
          showMore: Message.ClickedShowMoreLevelLines(),
          editLine: lineId => Message.ClickedEditLevelLine({ lineId }),
          editor: {
            stepEdge: (lineId, edge, step) =>
              Message.SteppedLineEdge({ lineId, edge, step }),
            stepPlayhead: step => Message.SteppedLevelPlayhead({ step }),
            select: lineId => Message.SelectedLevelLine({ lineId }),
            play: Message.ClickedPlayLevelLine(),
            stop: Message.ClickedStopLevelLine(),
            split: Message.ClickedSplitLine(),
            merge: (lineId, select) =>
              Message.ClickedMergeLines({ lineId, select }),
            remove: Message.ClickedDeleteLine(),
            undo: Message.ClickedUndoLineChange(),
            follow: FollowLineEditorPointer(),
            open: Message.ClickedOpenLineEditor(),
          },
          deleteClip: Message.ClickedDeleteClip(),
          keepClip: Message.ClickedKeepClip(),
          confirmDelete: Message.SubmittedDeleteClip(),
          dialog: message => Message.GotDeleteClipDialogMessage({ message }),
        },
        h,
      ),
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
