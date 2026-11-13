import { Option } from 'effect'
import { expect, given, role, scene, text } from 'foldkit/scene'
import { modelCredits } from 'virtual:intone/models'
import { describe, test } from 'vitest'

import type { StarterPack } from '../../services/starter-records'
import { starterPack } from '../line/starter'
import { AppRoute, initialModel, update, view } from '../main'
import {
  BackupState,
  ClearState,
  RestoreState,
  SettingsPage,
} from '../settings/settings'
import { creditsView } from './creditsView'

// /credits names every model the app ships, from the build's own list,
// and the recording it brings.

describe('/credits', () => {
  test('names every model the app ships with its licence and source, and the bundled recording’s voice', () => {
    scene(
      { update, view },
      given(initialModel(AppRoute.Credits())),
      expect(role('heading', { name: 'Credits', level: 1 })).toExist(),
      ...[
        'SwiftF0',
        'Silero VAD',
        'Whisper base',
        'Whisper small',
        'IPADIC',
      ].map(name =>
        expect(role('heading', { name: new RegExp(`^${name}`) })).toExist(),
      ),
      ...modelCredits.map(model =>
        expect(role('link', { name: `Source of ${model.name}` })).toHaveAttr(
          'href',
          model.source,
        ),
      ),
      expect(role('link', { name: 'Source of SwiftF0 0.3.0' })).toHaveAttr(
        'rel',
        'noopener noreferrer',
      ),
      expect(text(/Voice: VOICEVOX:冥鳴ひまり, made with VOICEVOX/)).toExist(),
      expect(role('heading', { name: 'Lindera 6.2.0' })).toExist(),
      expect(text('Licence: MIT')).toExist(),
      expect(role('link', { name: 'Source of Lindera 6.2.0' })).toHaveAttr(
        'href',
        'https://github.com/lindera/lindera/tree/v6.2.0',
      ),
      expect(role('link', { name: 'The notices' })).toHaveAttr(
        'href',
        '/NOTICES.md',
      ),
    )
  })

  test('names every starter recording’s author, source and licence, read from the pack', () => {
    const lines = starterPack.levels.flatMap(level => level.lines)
    scene(
      { update, view },
      given(initialModel(AppRoute.Credits())),
      ...starterPack.levels.map(level =>
        expect(role('heading', { name: level.name, level: 3 })).toExist(),
      ),
      ...lines.map(line =>
        expect(
          text(`${line.text} (${line.kana}): ${line.credit.author}`),
        ).toExist(),
      ),
      ...lines
        .filter(line => line.credit.source !== 'VOICEVOX')
        .map(line =>
          expect(
            role('link', { name: `${line.text} on ${line.credit.source}` }),
          ).toHaveAttr('href', line.credit.page),
        ),
      expect(text(/checked against UniDic 2023\.02/)).toExist(),
    )
  })

  test('names the native speaker who checked a line, when they agreed to be credited, and the day', () => {
    const [first, ...rest] = starterPack.levels
    if (first === undefined) {
      throw new Error('the pack has no level')
    }
    const [line, ...others] = first.lines
    if (line === undefined) {
      throw new Error('the first level has no line')
    }
    const reviewed: StarterPack = {
      ...starterPack,
      levels: [
        {
          ...first,
          lines: [
            {
              ...line,
              review: {
                verdict: 'accept',
                reviewedOn: '2026-12-01',
                reviewer: '山田花子',
              },
            },
            ...others,
          ],
        },
        ...rest,
      ],
    }
    scene(
      {
        update,
        view: (_model, h) => ({
          title: 'Credits',
          body: creditsView(h, reviewed),
        }),
      },
      given(initialModel(AppRoute.Credits())),
      expect(
        text(
          `${line.credit.changes} Checked by 山田花子, a native speaker, on 2026-12-01.`,
        ),
      ).toExist(),
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
