import {
  Command,
  changeFiles,
  click,
  dropFiles,
  expect,
  given,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { FocusUploadStatus } from './commands'
import { UploadJob, UploadStep, acceptedFiles } from './upload'
import { privacySentence } from './uploadView'

const onUpload = (): Model => initialModel(AppRoute.Upload())

const fileInput = selector('#upload-file')
const dropZone = selector('label')

const audioFile = new File([new Uint8Array(64)], 'reading.mp3', {
  type: 'audio/mpeg',
})

const working = (step: UploadStep): Model => ({
  ...onUpload(),
  upload: {
    ...onUpload().upload,
    jobsStarted: 1,
    job: UploadJob.Working({ jobNumber: 1, file: audioFile, step }),
  },
})

describe('/upload', () => {
  test('says in one plain sentence that the clip stays on this device', () => {
    scene(
      { update, view },
      given(onUpload()),
      expect(
        role('heading', { name: 'Bring your own audio', level: 1 }),
      ).toExist(),
      expect(text(privacySentence)).toExist(),
    )
  })

  test('takes a file from the picker, which offers audio files', () => {
    scene(
      { update, view },
      given(onUpload()),
      expect(fileInput).toHaveAttr('accept', acceptedFiles.join(',')),
      changeFiles(fileInput, [audioFile]),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      expect(
        role('heading', { name: 'Cutting reading.mp3 into lines', level: 2 }),
      ).toExist(),
    )
  })

  test('takes a file dropped on the zone', () => {
    scene(
      { update, view },
      given(onUpload()),
      dropFiles(dropZone, [audioFile]),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      expect(
        role('progressbar', { name: 'Cutting the clip into lines' }),
      ).toExist(),
    )
  })

  test('offers no address to import from and nothing to share', () => {
    scene(
      { update, view },
      given(onUpload()),
      expect(selector('input[type="url"]')).not.toExist(),
      expect(selector('input[type="text"]')).not.toExist(),
      expect(text(/youtube|url|share|export/i)).not.toExist(),
    )
  })

  test('shows how far the cut is, and a way to stop it', () => {
    scene(
      { update, view },
      given(working(UploadStep.TrackingLines({ done: 3, total: 12 }))),
      expect(role('progressbar')).toHaveAttr('aria-valuenow', '50'),
      expect(text('Finding each line’s pitch: 3 of 12.')).toExist(),
      click(role('button', { name: 'Stop' })),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      expect(role('status')).toHaveText(
        'Stopped. Nothing of reading.mp3 was kept.',
      ),
      expect(fileInput).toExist(),
    )
  })

  test('cannot be stopped while the clip is being kept', () => {
    scene(
      { update, view },
      given(working(UploadStep.Keeping())),
      expect(role('button', { name: 'Stop' })).toBeDisabled(),
    )
  })

  test('names a file it could not use, and why, and takes another', () => {
    scene(
      { update, view },
      given({
        ...onUpload(),
        upload: {
          ...onUpload().upload,
          job: UploadJob.Refused({
            name: 'song.opus',
            reason:
              'This browser cannot decode it. Convert it to WAV, MP3 or M4A and try again.',
          }),
        },
      }),
      expect(role('alert')).toHaveText(
        'song.opus could not be used. This browser cannot decode it. Convert it to WAV, MP3 or M4A and try again.',
      ),
      expect(fileInput).toExist(),
    )
  })
})
