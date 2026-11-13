import { Schema } from 'effect'

import { Dialog } from '@foldkit/ui'

import { HistoryPage, LineHistoryPage } from './history/history'
import { ClipsPage, LevelPage } from './level/level'
import { ListenSpeed, NativeCurve } from './line/native'
import { LinePlace } from './line/place'
import { DuePage } from './returns/returns'
import { AppRoute } from './route'
import { SettingsPage } from './settings/settings'
import { Take } from './take/take'
import { LineTextEdit, TextChoiceState, TextJob, TextOffer } from './text/text'
import { UploadPage } from './upload/upload'

export const Model = Schema.Struct({
  route: AppRoute,
  maybeDevLibraryFailure: Schema.Option(Schema.String),
  // The open line's native curve.
  native: NativeCurve,
  // The open line's place in its level: its stars, its best, the next.
  place: LinePlace,
  take: Take,
  // How many takes have started, so each has its own number.
  takesStarted: Schema.Finite,
  listenSpeed: ListenSpeed,
  // Why the last voice played did not, until another plays.
  maybePlaybackFailure: Schema.Option(Schema.String),
  // The history and settings screens, each read from the device when it
  // opens.
  history: HistoryPage,
  lineHistory: LineHistoryPage,
  settings: SettingsPage,
  // What the settings screen says once everything has been cleared.
  maybeSettingsNotice: Schema.Option(Schema.String),
  clearDialog: Dialog.Model,
  // Bringing a clip, the clips on the home screen, and a clip's lines.
  upload: UploadPage,
  clips: ClipsPage,
  // The lines due back for a blind take, read each time home opens.
  due: DuePage,
  level: LevelPage,
  deleteClipDialog: Dialog.Model,
  // What the home screen says once a clip has been deleted.
  maybeHomeNotice: Schema.Option(Schema.String),
  // The text of the learner's clips (./text/text.ts): what they said to
  // the model's download, the consent dialog, the one job in the
  // background, and the text they type or paste on a level.
  textChoice: TextChoiceState,
  textOffer: TextOffer,
  textDialog: Dialog.Model,
  textJob: TextJob,
  textJobsStarted: Schema.Finite,
  lineText: LineTextEdit,
})
export type Model = typeof Model.Type
