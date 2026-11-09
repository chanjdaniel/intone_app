import { Schema } from 'effect'

import { Dialog } from '@foldkit/ui'

import { HistoryPage, LineHistoryPage } from './history/history'
import { ListenSpeed, NativeCurve } from './line/native'
import { AppRoute } from './route'
import { SettingsPage } from './settings/settings'
import { Take } from './take/take'

export const Model = Schema.Struct({
  route: AppRoute,
  maybeDevLibraryFailure: Schema.Option(Schema.String),
  // The open line's native curve.
  native: NativeCurve,
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
})
export type Model = typeof Model.Type
