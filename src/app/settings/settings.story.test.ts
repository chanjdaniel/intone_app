import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { HistoryPage, LineHistoryPage } from '../history/history'
import { NativeCurve } from '../line/native'
import { AppRoute, Message, init, initialModel, update } from '../main'
import { LoadTextChoice } from '../text/commands'
import { LoadSettings } from './commands'
import { SettingsPage } from './settings'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

describe('/settings', () => {
  test('reads what the device keeps when it opens', () => {
    const start = init(url('/settings'))
    expect(start.model.settings).toStrictEqual(SettingsPage.Loading())
    expect(start.commands).toMatchObject([
      { name: LoadSettings.name },
      { name: LoadTextChoice.name },
    ])
  })

  test('forgets what the screens showed once everything is cleared, and says so', () => {
    story(
      update,
      given({
        ...initialModel(AppRoute.Settings()),
        history: HistoryPage.Loading(),
        lineHistory: LineHistoryPage.Loading({ clipId: 'a', lineId: '1' }),
        native: NativeCurve.Loading({ clipId: 'a', lineId: '1' }),
      }),
      message(Message.SucceededClearAllData()),
      Command.expectHas(LoadSettings()),
      model(current => {
        expect(current.settings).toStrictEqual(SettingsPage.Loading())
        expect(current.history).toStrictEqual(HistoryPage.NotLoaded())
        expect(current.lineHistory).toStrictEqual(LineHistoryPage.NotLoaded())
        expect(current.native).toStrictEqual(NativeCurve.NoLine())
        expect(Option.isSome(current.maybeSettingsNotice)).toBe(true)
      }),
      Command.resolve(
        LoadSettings,
        Message.FailedLoadSettings({ reason: 'x' }),
      ),
      message(Message.ChangedUrl({ url: url('/settings') })),
      Command.resolve(
        LoadSettings,
        Message.FailedLoadSettings({ reason: 'x' }),
      ),
      Command.resolve(
        LoadTextChoice,
        Message.SucceededLoadTextChoice({
          maybeChoice: Option.none(),
          modelKept: false,
        }),
      ),
      model(current => {
        expect(current.maybeSettingsNotice).toStrictEqual(Option.none())
      }),
    )
  })
})
