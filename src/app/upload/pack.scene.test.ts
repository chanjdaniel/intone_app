import { Option } from 'effect'
import {
  Command,
  Mount,
  all,
  changeFiles,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { initialEditor } from '../level/editor'
import {
  DeleteState,
  LevelPage,
  LevelStars,
  levelClipOf,
  levelRowsPerPage,
} from '../level/level'
import { samplePack } from '../level/testClips'
import { practiceLineOfClip } from '../line/lines'
import { NativeCurve } from '../line/native'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { DrawCurvePair } from '../take/curvePair'
import { sampleCurve, sampleFeatures } from '../take/testCurves'
import { FocusUploadStatus } from './commands'
import { packPrivacySentence } from './packView'
import { PackJob, PackStep } from './upload'

const onUpload = (): Model => initialModel(AppRoute.Upload())

const packInput = selector('#pack-files')

const manifest = new File(['{}'], 'pack.json', { type: 'application/json' })
const audio = new File([new Uint8Array(64)], 'hashi.wav', {
  type: 'audio/wav',
})

const importing = (step: PackStep): Model => ({
  ...onUpload(),
  upload: {
    ...onUpload().upload,
    jobsStarted: 1,
    packJob: PackJob.Working({ jobNumber: 1, files: [manifest, audio], step }),
  },
})

describe('the local pack on /upload', () => {
  test('says the pack stays on this device, and takes pack.json with its files', () => {
    scene(
      { update, view },
      given(onUpload()),
      expect(
        role('heading', { name: 'Import your local pack', level: 2 }),
      ).toExist(),
      expect(text(packPrivacySentence)).toExist(),
      expect(packInput).toHaveAttr('multiple'),
      changeFiles(packInput, [manifest, audio]),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      expect(
        role('progressbar', { name: 'Importing the local pack' }),
      ).toExist(),
      expect(text('Reading pack.json.')).toExist(),
    )
  })

  test('shows how far it is, stops, and keeps nothing', () => {
    scene(
      { update, view },
      given(importing(PackStep.TrackingLines({ done: 1, total: 4 }))),
      expect(text('Finding the pitch of each new line: 1 of 4.')).toExist(),
      click(role('button', { name: 'Stop' })),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      expect(role('status')).toHaveText(
        'Stopped. Nothing of the pack was kept.',
      ),
    )
  })

  test('cannot be stopped while it keeps, and no clip can be cut meanwhile', () => {
    scene(
      { update, view },
      given(importing(PackStep.Keeping())),
      expect(role('button', { name: 'Stop' })).toBeDisabled(),
      expect(selector('#upload-file')).toBeDisabled(),
    )
  })

  test('says why a pack was refused', () => {
    scene(
      { update, view },
      given({
        ...onUpload(),
        upload: {
          ...onUpload().upload,
          packJob: PackJob.Refused({
            reason:
              'pack.json names a file you did not choose: audio/kyou.wav. Choose it too, or the folder that holds the pack.',
          }),
        },
      }),
      expect(role('alert')).toHaveText(
        'The pack was not imported. pack.json names a file you did not choose: audio/kyou.wav. Choose it too, or the folder that holds the pack.',
      ),
    )
  })
})

const onPackLevel = (): Model => {
  const clip = levelClipOf(samplePack)
  return {
    ...initialModel(
      AppRoute.Level({ clipId: clip.id, maybeFind: Option.none() }),
    ),
    level: LevelPage.Ready({
      stars: LevelStars.Ready({ lines: [] }),
      clip,
      shownRows: levelRowsPerPage,
      deleting: DeleteState.Idle(),
      editor: initialEditor(clip),
    }),
  }
}

describe('a level from the local pack', () => {
  test('lists its lines by their text and kana, and one with no text by its place', () => {
    scene(
      { update, view },
      given(onPackLevel()),
      expect(
        role('heading', { name: 'Example local pack', level: 1 }),
      ).toExist(),
      expect(
        text(
          '3 lines from your local pack, kept on this device. To change them, change its pack.json and import it again.',
        ),
      ).toExist(),
      expectAll(
        all.role('link', { name: /^(橋を|今日は|Line 3)/ }),
      ).toHaveCount(3),
      expect(
        role('link', { name: /^橋を渡ります, はしをわたります/ }),
      ).toHaveAttr('href', '/line/pack-example/1'),
      expect(
        role('link', {
          name: /^Line 3, audio\/gongitsune\.wav · 0:00\.6 to 0:03\.6/,
        }),
      ).toExist(),
      expect(selector('[lang="ja"]')).toHaveText('橋を渡ります'),
    )
  })

  test('shows a source as a link that opens in a new tab, with no opener and no referrer', () => {
    scene(
      { update, view },
      given(onPackLevel()),
      expect(
        role('link', {
          name: 'Source on youtube.com, 0:12.5 to 0:14.1 (opens in a new tab)',
        }),
      ).toHaveAttr('href', 'https://www.youtube.com/watch?v=planted'),
      expect(role('link', { name: /^Source on youtube\.com/ })).toHaveAttr(
        'target',
        '_blank',
      ),
      expect(role('link', { name: /^Source on youtube\.com/ })).toHaveAttr(
        'rel',
        'noopener noreferrer',
      ),
      expectAll(all.role('link', { name: /^Source on/ })).toHaveCount(1),
    )
  })

  test('has no line editor: its manifest alone changes its lines', () => {
    scene(
      { update, view },
      given(onPackLevel()),
      expect(role('button', { name: /^Fix/ })).not.toExist(),
      expect(role('slider')).not.toExist(),
      expect(role('button', { name: 'Delete this pack' })).toExist(),
      expect(
        text(
          'Deletes the pack from this device with its lines, their audio, their curves and your takes of them. Your files in local/ stay where they are.',
        ),
      ).toExist(),
    )
  })
})

describe('the practice screen of a line of the local pack', () => {
  test('names the line by its text and kana, and links its source', () => {
    const line = samplePack.lines[0]!
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.Line({ clipId: 'pack-example', lineId: '1' })),
        native: NativeCurve.Ready({
          clipId: 'pack-example',
          lineId: '1',
          line: practiceLineOfClip(
            samplePack,
            line,
            samplePack.pack!.files[0]!.audio!,
          ),
          curve: sampleCurve,
          features: sampleFeatures,
        }),
      }),
      Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair()),
      expect(role('heading', { name: '橋を渡ります', level: 1 })).toExist(),
      expect(text('はしをわたります')).toHaveAttr('lang', 'ja'),
      expect(text('From your local pack, kept on this device.')).toExist(),
      expect(
        role('link', { name: /^Source on youtube\.com, 0:12\.5 to 0:14\.1/ }),
      ).toHaveAttr('target', '_blank'),
    )
  })
})
