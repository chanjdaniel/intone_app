import { Clock, Effect, Option, Schema } from 'effect'
import { Calendar, Command, File } from 'foldkit'

import { reasonOf } from '../../engine/reason'
import { clipHasAudio } from '../../services/history-records'
import { HistoryError, HistoryStore } from '../../services/history-store'
import { deleteTextModels } from '../../workers/text-model-cache'
import { isoDayOf } from '../history/format'
import { Message } from '../message'
import { forgetTakeAudio } from '../take/takeAudio'
import type { Browser, Persistence, StorageFacts } from './settings'

// What the settings screen reads and does on the device: the browser's
// storage promises, the kept-audio setting, the backup file, and
// clearing everything. Nothing here sends anything anywhere: the backup
// is a file the learner saves.

// Safari, by its user agent: WebKit's own, without another browser's
// name; on an iPhone or iPad every browser is WebKit, and only Safari
// itself offers Add to Home Screen with its storage kept.
export const browserOf = (userAgent: string, standalone: boolean): Browser => {
  const isSafari =
    /Safari\//.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|EdgA|OPiOS|Android)/.test(userAgent)
  if (!isSafari) {
    return 'Other'
  }
  return standalone ? 'SafariHomeScreen' : 'Safari'
}

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && navigator.standalone === true)

const persistenceOf = (persisted: boolean): Persistence =>
  persisted ? 'Granted' : 'NotGranted'

const hasStorageManager = (): boolean =>
  'storage' in navigator && typeof navigator.storage.persisted === 'function'

// What the browser has promised about the app's storage, and how much it
// uses.
export const readStorageFacts: Effect.Effect<StorageFacts> = Effect.promise(
  async (): Promise<StorageFacts> => {
    const browser = browserOf(navigator.userAgent, isStandalone())
    if (!hasStorageManager()) {
      return {
        persistence: 'Unsupported',
        maybeUsageBytes: Option.none(),
        maybeQuotaBytes: Option.none(),
        browser,
      }
    }
    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted().catch(() => false),
      navigator.storage.estimate().catch((): StorageEstimate => ({})),
    ])
    return {
      persistence: persistenceOf(persisted),
      maybeUsageBytes: Option.fromNullishOr(estimate.usage),
      maybeQuotaBytes: Option.fromNullishOr(estimate.quota),
      browser,
    }
  },
)

// Asks the browser to keep the app's storage when the device runs short
// of space: once the first take is kept, and again from the settings. A
// browser that has already said yes is not asked again.
export const AskToPersistStorage = Command.define('AskToPersistStorage', {
  messages: [Message.CompletedAskToPersistStorage],
  execute: Effect.promise(async () => {
    if (hasStorageManager()) {
      const persisted = await navigator.storage.persisted().catch(() => false)
      if (!persisted) {
        await navigator.storage.persist().catch(() => false)
      }
    }
  }).pipe(
    Effect.andThen(readStorageFacts),
    Effect.map(storage => Message.CompletedAskToPersistStorage({ storage })),
  ),
})

export const LoadSettings = Command.define('LoadSettings', {
  messages: [Message.SucceededLoadSettings, Message.FailedLoadSettings],
  execute: Effect.gen(function* () {
    const history = yield* HistoryStore
    const settings = yield* history.settings
    const { entries } = yield* history.entries
    const { clips } = yield* history.clips
    const storage = yield* readStorageFacts
    return Message.SucceededLoadSettings({
      facts: {
        keepTakeAudio: settings.keepTakeAudio,
        takes: entries.length,
        takesWithAudio: entries.filter(entry => entry.audio !== null).length,
        clipsWithAudio: clips.filter(clipHasAudio).length,
        storage,
      },
    })
  }).pipe(
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadSettings({ reason: error.reason })),
    ),
  ),
})

export const SetKeepTakeAudio = Command.define('SetKeepTakeAudio', {
  args: { keep: Schema.Boolean },
  messages: [Message.SucceededSetKeepTakeAudio, Message.FailedSetKeepTakeAudio],
  execute: ({ keep }) =>
    HistoryStore.use(history =>
      history.settings.pipe(
        Effect.flatMap(settings =>
          history.setSettings({ ...settings, keepTakeAudio: keep }),
        ),
      ),
    ).pipe(
      Effect.as(Message.SucceededSetKeepTakeAudio({ keep })),
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedSetKeepTakeAudio({ reason: error.reason }),
        ),
      ),
    ),
})

const loadBackupCode = Effect.tryPromise({
  try: () => import('../../services/backup'),
  catch: () =>
    new HistoryError({
      reason: 'The backup code did not load. Reload the page and try again.',
    }),
})

// Hands `bytes` to the browser as a file to save, named `fileName`.
const saveFile = (bytes: Uint8Array, fileName: string): Effect.Effect<void> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], { type: 'application/zip' }),
      ),
    ),
    url =>
      Effect.sync(() => {
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        link.hidden = true
        document.body.append(link)
        link.click()
        link.remove()
      }),
    // NOTE: the browser reads the file from its URL after the click
    // returns, so the URL is let go a moment later.
    url =>
      Effect.sleep('1 second').pipe(
        Effect.andThen(Effect.sync(() => URL.revokeObjectURL(url))),
      ),
  )

// Makes the backup file, the kept audio in it only when `includeAudio`,
// and hands it to the browser to save on the device.
export const SaveBackup = Command.define('SaveBackup', {
  args: { includeAudio: Schema.Boolean },
  messages: [Message.SucceededSaveBackup, Message.FailedSaveBackup],
  execute: ({ includeAudio }) =>
    Effect.gen(function* () {
      const { encodeBackup, backupFileName } = yield* loadBackupCode
      const history = yield* HistoryStore
      const dump = yield* history.dump(includeAudio)
      const exportedAt = yield* Clock.currentTimeMillis
      const bytes = yield* Effect.try({
        try: () => encodeBackup(dump, exportedAt),
        catch: error =>
          new HistoryError({
            reason: `The backup was not made: ${reasonOf(error)}`,
          }),
      })
      const fileName = backupFileName(
        isoDayOf(Calendar.fromDateLocal(new Date(exportedAt))),
      )
      yield* Effect.forkDetach(saveFile(bytes, fileName))
      return Message.SucceededSaveBackup({
        fileName,
        takes: dump.takes.length,
      })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(Message.FailedSaveBackup({ reason: error.reason })),
      ),
    ),
})

// Asks the learner for a backup file, checks it whole, and adds its takes
// to the history; a file that is not a backup changes nothing.
export const RestoreBackup = Command.define('RestoreBackup', {
  messages: [
    Message.SucceededRestoreBackup,
    Message.CompletedRestoreBackup,
    Message.FailedRestoreBackup,
  ],
  execute: Effect.gen(function* () {
    const maybeFile = yield* File.select(['.zip', 'application/zip'])
    if (Option.isNone(maybeFile)) {
      return Message.CompletedRestoreBackup()
    }
    const buffer = yield* File.readAsArrayBuffer(maybeFile.value).pipe(
      Effect.mapError(
        () => new HistoryError({ reason: 'The file could not be read.' }),
      ),
    )
    const { decodeBackup } = yield* loadBackupCode
    const dump = yield* decodeBackup(new Uint8Array(buffer))
    const history = yield* HistoryStore
    const takes = yield* history.restore(dump)
    return Message.SucceededRestoreBackup({ takes })
  }).pipe(
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedRestoreBackup({ reason: error.reason })),
    ),
  ),
})

// Deletes everything the app keeps on the device, and the last take's
// audio in memory.
export const ClearAllData = Command.define('ClearAllData', {
  messages: [Message.SucceededClearAllData, Message.FailedClearAllData],
  execute: HistoryStore.use(history => history.clear).pipe(
    Effect.andThen(forgetTakeAudio),
    // The text model's files go too: everything Intone keeps here.
    Effect.andThen(deleteTextModels),
    Effect.as(Message.SucceededClearAllData()),
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedClearAllData({ reason: error.reason })),
    ),
  ),
})
