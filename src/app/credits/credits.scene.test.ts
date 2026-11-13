import { Option } from 'effect'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { modelCredits } from 'virtual:intone/models'
import { describe, test } from 'vitest'

import { AppRoute, initialModel, update, view } from '../main'
import {
  BackupState,
  ClearState,
  RestoreState,
  SettingsPage,
} from '../settings/settings'

// /credits names every model the app ships, from the build's own list,
// and the recording it brings.

describe('/credits', () => {
  test('names every model the app ships with its licence and source, and the bundled recording’s voice', () => {
    scene(
      { update, view },
      given(initialModel(AppRoute.Credits())),
      expect(role('heading', { name: 'Credits', level: 1 })).toExist(),
      ...['SwiftF0', 'Silero VAD', 'Whisper base', 'Whisper small'].map(name =>
        expect(role('heading', { name: new RegExp(`^${name}`) })).toExist(),
      ),
      ...modelCredits.map(model =>
        expect(role('link', { name: model.source })).toHaveAttr(
          'rel',
          'noopener noreferrer',
        ),
      ),
      expect(text(/voice VOICEVOX:冥鳴ひまり, made with VOICEVOX/)).toExist(),
      expect(role('link', { name: 'The notices' })).toHaveAttr(
        'href',
        '/NOTICES.md',
      ),
    )
  })

  test('is reached from the settings', () => {
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.Settings()),
        settings: SettingsPage.Ready({
          keepTakeAudio: false,
          takes: 0,
          takesWithAudio: 0,
          clipsWithAudio: 0,
          storage: {
            persistence: 'Granted',
            maybeUsageBytes: Option.none(),
            maybeQuotaBytes: Option.none(),
            browser: 'Other',
          },
          maybeKeepAudioFailure: Option.none(),
          includeAudio: false,
          backup: BackupState.Idle(),
          restore: RestoreState.Idle(),
          clearing: ClearState.Idle(),
        }),
      }),
      expect(
        role('link', { name: 'Credits for the models and recordings' }),
      ).toHaveAttr('href', '/credits'),
    )
  })
})
