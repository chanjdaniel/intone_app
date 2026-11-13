import { expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { init, update, view } from './line-row'

describe('the line row entry', () => {
  test('links each bundled line to its practice screen', () => {
    scene(
      { update, view },
      given(init().model),
      expect(role('link', { name: 'Copy 雨が好き, あめがすき' })).toHaveAttr(
        'href',
        '/line/ame-ga-suki/1',
      ),
      expect(text('Voice: VOICEVOX:冥鳴ひまり, made with VOICEVOX.')).toExist(),
      expect(text('Read-out: 雨が好き links to /line/ame-ga-suki/1')).toExist(),
    )
  })
})
