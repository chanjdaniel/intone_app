import { Option } from 'effect'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  role,
  scene,
  submit,
  text,
} from 'foldkit/scene'
import { describe, expect as expectValue, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import {
  AskToPersistStorage,
  ClearAllData,
  LoadSettings,
  RestoreBackup,
  SaveBackup,
  SetKeepTakeAudio,
  browserOf,
} from './commands'
import {
  BackupState,
  ClearState,
  RestoreState,
  SettingsPage,
  type StorageFacts,
} from './settings'
import { clearedNotice } from './update'

// The settings screen: storage said plainly, Safari's limit, the kept
// audio, the backup and clearing everything.

const storage = (overrides: Partial<StorageFacts> = {}): StorageFacts => ({
  persistence: 'NotGranted',
  maybeUsageBytes: Option.some(2_340_000),
  maybeQuotaBytes: Option.some(11e9),
  browser: 'Other',
  ...overrides,
})

const onSettings = (
  overrides: Partial<Extract<SettingsPage, { _tag: 'Ready' }>> = {},
): Model => ({
  ...initialModel(AppRoute.Settings()),
  settings: SettingsPage.Ready({
    keepTakeAudio: false,
    takes: 12,
    takesWithAudio: 0,
    storage: storage(),
    maybeKeepAudioFailure: Option.none(),
    includeAudio: false,
    backup: BackupState.Idle(),
    restore: RestoreState.Idle(),
    clearing: ClearState.Idle(),
    ...overrides,
  }),
})

const dialogShown = [
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  Mount.resolve(
    Dialog.AcquireResources,
    Dialog.Message.SucceededAcquireResources(),
  ),
] as const

describe('the browser', () => {
  test('is Safari only when WebKit names no other browser, and a Home Screen app when standalone', () => {
    const iPhoneSafari =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
    const macSafari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
    const iPhoneChrome =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1'
    const desktopChrome =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    const firefox =
      'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'
    expectValue(browserOf(iPhoneSafari, false)).toBe('Safari')
    expectValue(browserOf(macSafari, false)).toBe('Safari')
    expectValue(browserOf(iPhoneSafari, true)).toBe('SafariHomeScreen')
    expectValue(browserOf(iPhoneChrome, false)).toBe('Other')
    expectValue(browserOf(desktopChrome, false)).toBe('Other')
    expectValue(browserOf(firefox, true)).toBe('Other')
  })
})

describe('/settings', () => {
  test('says so while it reads what the device keeps, and when it cannot', () => {
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.Settings()),
        settings: SettingsPage.Loading(),
      }),
      expect(text('Reading what this device keeps.')).toExist(),
    )
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.Settings()),
        settings: SettingsPage.Failed({ reason: 'Gone.' }),
      }),
      expect(role('alert')).toHaveText('The settings could not be read. Gone.'),
    )
  })

  test('says plainly what the browser promised about storage, and offers to ask again when it did not', () => {
    scene(
      { update, view },
      given(onSettings()),
      expect(
        text(
          /^The browser has not agreed to keep Intone’s storage, so it may delete your history/,
        ),
      ).toExist(),
      expect(
        text(
          'Intone uses about 2.3 MB of this device’s storage, of 11 GB the browser allows it.',
        ),
      ).toExist(),
      click(role('button', { name: 'Ask the browser to keep it' })),
      Command.expectExact(AskToPersistStorage()),
      Command.resolve(
        AskToPersistStorage,
        Message.CompletedAskToPersistStorage({
          storage: storage({ persistence: 'Granted' }),
        }),
      ),
      expect(
        text(
          /^The browser has agreed to keep Intone’s storage: it will not delete your history/,
        ),
      ).toExist(),
      expect(
        role('button', { name: 'Ask the browser to keep it' }),
      ).toBeAbsent(),
      expect(role('heading', { name: 'On Safari' })).toBeAbsent(),
    )
  })

  test('on Safari, suggests the Home Screen and says why; from the Home Screen, says the limit is gone', () => {
    scene(
      { update, view },
      given(onSettings({ storage: storage({ browser: 'Safari' }) })),
      expect(role('heading', { name: 'On Safari' })).toExist(),
      expect(
        text(
          /^Safari deletes what a site keeps after seven days without a visit/,
        ),
      ).toExist(),
      expect(
        text(
          /^Add Intone to your Home Screen \(Share, then Add to Home Screen/,
        ),
      ).toExist(),
      expect(text(/save a backup here, then restore it there\.$/)).toExist(),
    )
    scene(
      { update, view },
      given(onSettings({ storage: storage({ browser: 'SafariHomeScreen' }) })),
      expect(text(/^Intone is running from your Home Screen/)).toExist(),
    )
  })

  test('keeps take audio only once it is turned on, and says when that did not stick', () => {
    scene(
      { update, view },
      given(onSettings()),
      expect(
        role('checkbox', { name: 'Keep the recording of each take' }),
      ).not.toBeChecked(),
      click(role('checkbox', { name: 'Keep the recording of each take' })),
      Command.expectExact(SetKeepTakeAudio({ keep: true })),
      expect(
        role('checkbox', { name: 'Keep the recording of each take' }),
      ).toBeChecked(),
      Command.resolve(
        SetKeepTakeAudio,
        Message.FailedSetKeepTakeAudio({ reason: 'The disk is full.' }),
      ),
      expect(
        role('checkbox', { name: 'Keep the recording of each take' }),
      ).not.toBeChecked(),
      expect(text('That did not change: The disk is full.')).toExist(),
    )
  })

  test('saves a backup with the kept audio only when asked, and says what it saved', () => {
    scene(
      { update, view },
      given(onSettings({ takesWithAudio: 4 })),
      click(role('button', { name: 'Save a backup' })),
      Command.expectExact(SaveBackup({ includeAudio: false })),
      Command.resolve(
        SaveBackup,
        Message.SucceededSaveBackup({
          fileName: 'intone-history-2026-11-10.zip',
          takes: 12,
        }),
      ),
      expect(
        text('Saved intone-history-2026-11-10.zip, with 12 takes.'),
      ).toExist(),
      click(
        role('checkbox', { name: 'Include the kept recordings (4 takes)' }),
      ),
      click(role('button', { name: 'Save a backup' })),
      Command.expectExact(SaveBackup({ includeAudio: true })),
      Command.resolve(
        SaveBackup,
        Message.FailedSaveBackup({ reason: 'No room.' }),
      ),
      expect(text('The backup was not saved. No room.')).toExist(),
    )
  })

  test('offers no audio for the backup when none is kept', () => {
    scene(
      { update, view },
      given(onSettings()),
      expect(
        role('checkbox', {
          name: 'Include the kept recordings (none are kept)',
        }),
      ).toBeDisabled(),
    )
  })

  test('restores a backup, or says why nothing was restored', () => {
    scene(
      { update, view },
      given(onSettings()),
      click(role('button', { name: 'Restore from a backup' })),
      Command.resolve(
        RestoreBackup,
        Message.FailedRestoreBackup({
          reason:
            'This file is not an Intone backup this app can read: it is not a zip file.',
        }),
      ),
      expect(
        text(
          'Nothing was restored. This file is not an Intone backup this app can read: it is not a zip file.',
        ),
      ).toExist(),
      click(role('button', { name: 'Restore from a backup' })),
      Command.resolve(
        RestoreBackup,
        Message.SucceededRestoreBackup({ takes: 5 }),
      ),
      expect(text('Restored 5 takes from the backup.')).toExist(),
      Command.resolve(
        LoadSettings,
        Message.SucceededLoadSettings({
          facts: {
            keepTakeAudio: false,
            takes: 17,
            takesWithAudio: 0,
            storage: storage(),
          },
        }),
      ),
      expect(text('Restored 5 takes from the backup.')).toExist(),
    )
  })

  test('clears everything only once the dialog confirms it, and keeps everything when it does not', () => {
    scene(
      { update, view },
      given(onSettings()),
      click(role('button', { name: 'Clear all data…' })),
      ...dialogShown,
      expect(role('heading', { name: 'Delete everything?' })).toExist(),
      click(role('button', { name: 'Keep everything' })),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(role('heading', { name: 'Delete everything?' })).toBeAbsent(),
      click(role('button', { name: 'Clear all data…' })),
      ...dialogShown,
      submit(role('form')),
      Command.expectExact(ClearAllData()),
      expect(role('button', { name: 'Deleting…' })).toBeDisabled(),
      Command.resolve(
        ClearAllData,
        Message.FailedClearAllData({ reason: 'Blocked.' }),
      ),
      expect(role('alert')).toHaveText('Nothing was deleted. Blocked.'),
      submit(role('form')),
      Command.resolve(ClearAllData, Message.SucceededClearAllData()),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(role('status')).toHaveText(clearedNotice),
      Command.resolve(
        LoadSettings,
        Message.SucceededLoadSettings({
          facts: {
            keepTakeAudio: false,
            takes: 0,
            takesWithAudio: 0,
            storage: storage(),
          },
        }),
      ),
      expect(text(clearedNotice)).toExist(),
    )
  })
})
