import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { FileDrop } from '@foldkit/ui'

import { LoadClips } from '../level/commands'
import { ClipsPage } from '../level/level'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { FocusUploadStatus, OpenLevel } from './commands'
import { packJobOf } from './subscriptions'
import { PackJob, PackStep, UploadJob, packProgressOf } from './upload'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const onUpload = (): Model => initialModel(AppRoute.Upload())

const manifest = new File(['{}'], 'pack.json', { type: 'application/json' })
const audio = new File([new Uint8Array(64)], 'hashi.wav', {
  type: 'audio/wav',
})

const droppedPack = (files: readonly [File, ...Array<File>]) =>
  Message.GotPackDropMessage({
    message: FileDrop.Message.DroppedFiles({ files }),
  })

const importing = (step: PackStep = PackStep.Reading()): Model => ({
  ...onUpload(),
  upload: {
    ...onUpload().upload,
    jobsStarted: 1,
    packJob: PackJob.Working({ jobNumber: 1, files: [manifest, audio], step }),
  },
})

describe('importing the local pack', () => {
  test('the files dropped or chosen start one import, which runs while it works', () => {
    story(
      update,
      given(onUpload()),
      message(droppedPack([manifest, audio])),
      Command.expectExact(FocusUploadStatus()),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => {
        expect(current.upload.packJob).toStrictEqual(
          PackJob.Working({
            jobNumber: 1,
            files: [manifest, audio],
            step: PackStep.Reading(),
          }),
        )
        expect(packJobOf(current)).toStrictEqual(
          Option.some({ jobNumber: 1, files: [manifest, audio] }),
        )
      }),
    )
  })

  test('a folder chosen starts it the same way', () => {
    story(
      update,
      given(onUpload()),
      message(
        Message.GotPackFolderMessage({
          message: FileDrop.Message.DroppedFiles({ files: [manifest, audio] }),
        }),
      ),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => {
        expect(current.upload.packJob._tag).toBe('Working')
      }),
    )
  })

  test('nothing starts while a clip is being cut, and a cut does not start while a pack is imported', () => {
    const cutting: Model = {
      ...onUpload(),
      upload: {
        ...onUpload().upload,
        jobsStarted: 1,
        job: UploadJob.Working({
          jobNumber: 1,
          file: audio,
          step: { _tag: 'Checking' },
        }),
      },
    }
    story(
      update,
      given(cutting),
      message(droppedPack([manifest, audio])),
      model(current => {
        expect(current.upload.packJob).toStrictEqual(PackJob.Idle())
      }),
    )
    story(
      update,
      given(importing()),
      message(
        Message.GotUploadDropMessage({
          message: FileDrop.Message.DroppedFiles({ files: [audio] }),
        }),
      ),
      model(current => {
        expect(current.upload.job).toStrictEqual(UploadJob.Idle())
      }),
    )
  })

  test('each step moves the progress on, and a step of another job changes nothing', () => {
    const step = PackStep.TrackingLines({ done: 2, total: 4 })
    story(
      update,
      given(importing()),
      message(Message.ProgressedPackImport({ jobNumber: 2, step })),
      model(current => {
        expect(current.upload.packJob).toMatchObject({
          step: PackStep.Reading(),
        })
      }),
      message(Message.ProgressedPackImport({ jobNumber: 1, step })),
      model(current => {
        expect(current.upload.packJob).toMatchObject({ step })
        expect(packProgressOf(step)).toBeCloseTo(0.525)
      }),
    )
  })

  test('once kept, the level opens and the home list is read again', () => {
    story(
      update,
      given(importing(PackStep.Keeping())),
      message(
        Message.SucceededPackImport({ jobNumber: 1, clipId: 'pack-example' }),
      ),
      Command.expectExact(OpenLevel({ clipId: 'pack-example' })),
      Command.resolve(OpenLevel, Message.CompletedOpenLevel()),
      model(current => {
        expect(current.upload.packJob).toStrictEqual(PackJob.Idle())
        expect(current.clips).toStrictEqual(ClipsPage.NotLoaded())
      }),
    )
  })

  test('a refusal says why, and a new cut replaces what it said', () => {
    story(
      update,
      given(importing()),
      message(
        Message.FailedPackImport({
          jobNumber: 1,
          reason: 'pack.json names a file you did not choose: audio/kyou.wav.',
        }),
      ),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => {
        expect(current.upload.packJob).toStrictEqual(
          PackJob.Refused({
            reason:
              'pack.json names a file you did not choose: audio/kyou.wav.',
          }),
        )
      }),
      message(
        Message.GotUploadDropMessage({
          message: FileDrop.Message.DroppedFiles({ files: [audio] }),
        }),
      ),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => {
        expect(current.upload.packJob).toStrictEqual(PackJob.Idle())
        expect(current.upload.job._tag).toBe('Working')
      }),
    )
  })

  test('Stop ends the import before it keeps, but not while it keeps', () => {
    story(
      update,
      given(importing(PackStep.CheckingFiles({ done: 1, total: 3 }))),
      message(Message.ClickedCancelPackImport()),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => {
        expect(current.upload.packJob).toStrictEqual(PackJob.Cancelled())
        expect(packJobOf(current)).toStrictEqual(Option.none())
      }),
    )
    story(
      update,
      given(importing(PackStep.Keeping())),
      message(Message.ClickedCancelPackImport()),
      model(current => {
        expect(current.upload.packJob._tag).toBe('Working')
      }),
    )
  })

  test('leaving the screen stops it', () => {
    story(
      update,
      given(importing()),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      model(current => {
        expect(current.upload.packJob).toStrictEqual(PackJob.Idle())
      }),
    )
  })
})
