import { Option } from 'effect'
import { Mount, expect, given, inside, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { bundledClips } from '../line/lines'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { initialEditor } from './editor'
import { FollowLineEditorPointer } from './editorPointer'
import {
  DeleteState,
  type LevelClip,
  LevelPage,
  LevelStars,
  levelClipOfBundled,
  levelRowsPerPage,
} from './level'
import { sampleClip } from './testClips'

// A level as a row of lines with their stars: the bundled clip's, an
// upload's and the local pack's alike, any line picked from it.

const onLevel = (clip: LevelClip, stars: LevelStars): Model => ({
  ...initialModel(
    AppRoute.Level({ clipId: clip.id, maybeFind: Option.none() }),
  ),
  level: LevelPage.Ready({
    clip,
    stars,
    shownRows: levelRowsPerPage,
    deleting: DeleteState.Idle(),
    editor: initialEditor(clip),
  }),
})

const bundled = levelClipOfBundled(bundledClips[0]!)

const pointerFollowed = Mount.resolve(
  FollowLineEditorPointer,
  Message.CompletedFollowLineEditorPointer(),
)

describe('a level’s stars', () => {
  test('the bundled clip is a level: its line with its stars, no editor and nothing to delete', () => {
    scene(
      { update, view },
      given(
        onLevel(
          bundled,
          LevelStars.Ready({
            lines: [
              {
                lineId: '1',
                progress: { stars: 2, maybeBestMatch: Option.some(0.93) },
              },
            ],
          }),
        ),
      ),
      expect(role('heading', { name: '雨が好き', level: 1 })).toExist(),
      expect(text('1 line, bundled with the app.')).toExist(),
      expect(role('heading', { name: '2 of 3 stars', level: 2 })).toExist(),
      expect(
        role('link', {
          name: /^雨が好き, あめがすき, Line 1 · 0:00\.0 to 0:01\.2/,
        }),
      ).toHaveAttr('href', '/line/ame-ga-suki/1'),
      inside(
        role('link', { name: /^雨が好き/ }),
        expect(role('img', { name: '2 of 3 stars' })).toExist(),
      ),
      expect(role('button', { name: /^Fix/ })).toBeAbsent(),
      expect(role('button', { name: 'Delete this clip' })).toBeAbsent(),
    )
  })

  test('each line of an upload shows its own stars, and the level sums them', () => {
    scene(
      { update, view },
      given(
        onLevel(
          sampleClip(3),
          LevelStars.Ready({
            lines: [
              {
                lineId: '1',
                progress: { stars: 3, maybeBestMatch: Option.some(0.9) },
              },
              {
                lineId: '3',
                progress: { stars: 1, maybeBestMatch: Option.some(0.77) },
              },
            ],
          }),
        ),
      ),
      pointerFollowed,
      expect(role('heading', { name: '4 of 9 stars' })).toExist(),
      inside(
        role('link', { name: /^Line 1,/ }),
        expect(role('img', { name: '3 of 3 stars' })).toExist(),
      ),
      inside(
        role('link', { name: /^Line 3,/ }),
        expect(role('img', { name: '1 of 3 stars' })).toExist(),
      ),
      expect(text('One star for 75% on a guided take.')).toExist(),
    )
  })

  test('stars not yet read show nothing; stars that could not be read say why', () => {
    scene(
      { update, view },
      given(onLevel(sampleClip(3), LevelStars.Loading())),
      pointerFollowed,
      expect(role('img', { name: /of 3 stars$/ })).toBeAbsent(),
    )
    scene(
      { update, view },
      given(
        onLevel(
          sampleClip(3),
          LevelStars.Failed({ reason: 'The disk is busy.' }),
        ),
      ),
      pointerFollowed,
      expect(role('alert')).toHaveText(
        'Your stars could not be read. The disk is busy.',
      ),
    )
  })
})
