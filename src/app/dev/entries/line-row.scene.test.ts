import { expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './line-row'

const credit = 'Voice: VOICEVOX:冥鳴ひまり, made with VOICEVOX.'

describe('the line row entry', () => {
  test('links each bundled line to its practice screen, named by all it shows', () => {
    scene(
      { update, view },
      given(init().model),
      expect(
        role('link', { name: `Copy 雨が好き, あめがすき, ${credit}` }),
      ).toHaveAttr('href', '/line/ame-ga-suki/1'),
      expect(text(credit)).toExist(),
      expect(text('Read-out: 雨が好き links to /line/ame-ga-suki/1')).toExist(),
    )
  })
})
