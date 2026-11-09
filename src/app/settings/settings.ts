import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

// The settings screen's part of the Model: whether takes keep their
// audio, what the browser has promised about the device's storage, and
// the backup, the restore and clearing everything.

// Whether the browser keeps the app's storage when the device runs short
// of space (`navigator.storage.persist()`).
export const Persistence = Schema.Literals([
  'Granted',
  'NotGranted',
  'Unsupported',
])
export type Persistence = typeof Persistence.Type

// Safari deletes a site's storage after seven days without a visit,
// except a web app added to the Home Screen, which keeps its own.
export const Browser = Schema.Literals(['Safari', 'SafariHomeScreen', 'Other'])
export type Browser = typeof Browser.Type

export const StorageFacts = Schema.Struct({
  persistence: Persistence,
  maybeUsageBytes: Schema.Option(Schema.Finite),
  maybeQuotaBytes: Schema.Option(Schema.Finite),
  browser: Browser,
})
export type StorageFacts = typeof StorageFacts.Type

export const BackupState = defineTaggedUnion({
  Idle: {},
  Saving: {},
  Saved: { fileName: Schema.String, takes: Schema.Finite },
  Failed: { reason: Schema.String },
})
export type BackupState = typeof BackupState.Type

export const RestoreState = defineTaggedUnion({
  Idle: {},
  Restoring: {},
  Restored: { takes: Schema.Finite },
  Failed: { reason: Schema.String },
})
export type RestoreState = typeof RestoreState.Type

export const ClearState = defineTaggedUnion({
  Idle: {},
  Clearing: {},
  Failed: { reason: Schema.String },
})
export type ClearState = typeof ClearState.Type

// What the settings screen reads from the device when it opens.
export const SettingsFacts = Schema.Struct({
  keepTakeAudio: Schema.Boolean,
  takes: Schema.Finite,
  takesWithAudio: Schema.Finite,
  storage: StorageFacts,
})
export type SettingsFacts = typeof SettingsFacts.Type

export const SettingsPage = defineTaggedUnion({
  NotLoaded: {},
  Loading: {},
  Ready: {
    ...SettingsFacts.fields,
    // Why turning kept audio on or off did not stick.
    maybeKeepAudioFailure: Schema.Option(Schema.String),
    // Whether the next backup brings the kept audio.
    includeAudio: Schema.Boolean,
    backup: BackupState,
    restore: RestoreState,
    clearing: ClearState,
  },
  Failed: { reason: Schema.String },
})
export type SettingsPage = typeof SettingsPage.Type

export const clearDialogId = 'clear-all-dialog'
