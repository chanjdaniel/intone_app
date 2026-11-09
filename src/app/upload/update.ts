import { Array, Option } from 'effect'
import { File, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { FileDrop } from '@foldkit/ui'

import { ClipsPage } from '../level/level'
import { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import { FocusUploadStatus, OpenLevel } from './commands'
import { UploadJob, UploadStep, refusalOf } from './upload'

// The upload screen's transitions: a file chosen or dropped starts a cut,
// each step of it moves the progress on, and its end opens the clip's
// lines. A step or an end from a job that is no longer running (it was
// cancelled, or the screen was left) changes nothing.

type UploadUpdate = Update.Return<Model, Message, AppResourceServices>

const unchanged = (model: Model): UploadUpdate => ({ model })

const withJob = (model: Model, job: UploadJob): Model =>
  modifyFields(model, {
    upload: upload => modifyFields(upload, { job: () => job }),
  })

const isWorking = (model: Model, jobNumber: number): boolean =>
  model.upload.job._tag === 'Working' &&
  model.upload.job.jobNumber === jobNumber

const nameOfJob = (model: Model): string =>
  model.upload.job._tag === 'Working'
    ? File.name(model.upload.job.file)
    : 'The file'

// Starts cutting `file`, unless it is plainly not audio.
const started = (model: Model, file: File.File): UploadUpdate => {
  if (model.upload.job._tag === 'Working') {
    return unchanged(model)
  }
  const refusal = refusalOf(file)
  if (refusal !== null) {
    return {
      model: withJob(
        model,
        UploadJob.Refused({ name: File.name(file), reason: refusal }),
      ),
      commands: [FocusUploadStatus()],
    }
  }
  const jobNumber = model.upload.jobsStarted + 1
  return {
    model: modifyFields(model, {
      upload: upload =>
        modifyFields(upload, {
          jobsStarted: () => jobNumber,
          job: () =>
            UploadJob.Working({
              jobNumber,
              file,
              step: UploadStep.Checking(),
            }),
        }),
    }),
    commands: [FocusUploadStatus()],
  }
}

const foldFileDropOutMessage = FileDrop.OutMessage.match<
  Update.Step<Model, Message, AppResourceServices>
>({
  ReceivedFiles:
    ({ files }) =>
    model =>
      started(model, Array.headNonEmpty(files)),
  RejectedNonFiles: () => model => ({
    model: withJob(
      model,
      UploadJob.Refused({
        name: 'That',
        reason: 'Only a file can be dropped here: choose or drop a recording.',
      }),
    ),
    commands: [FocusUploadStatus()],
  }),
})

export const foldUploadDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.upload.fileDrop),
  write: (model: Model, nextFileDrop: FileDrop.Model) =>
    modifyFields(model, {
      upload: upload => modifyFields(upload, { fileDrop: () => nextFileDrop }),
    }),
  toParentMessage: (message: FileDrop.Message) =>
    Message.GotUploadDropMessage({ message }),
  foldOutMessage: foldFileDropOutMessage,
})

export const progressedUpload = (
  model: Model,
  jobNumber: number,
  step: UploadStep,
): UploadUpdate =>
  model.upload.job._tag === 'Working' && isWorking(model, jobNumber)
    ? {
        model: withJob(model, UploadJob.Working({ ...model.upload.job, step })),
      }
    : unchanged(model)

// The clip is kept: its lines open, and the home screen's list will be
// read again.
export const succeededUpload = (
  model: Model,
  jobNumber: number,
  clipId: string,
): UploadUpdate =>
  isWorking(model, jobNumber)
    ? {
        model: modifyFields(withJob(model, UploadJob.Idle()), {
          clips: () => ClipsPage.NotLoaded(),
        }),
        commands: [OpenLevel({ clipId })],
      }
    : unchanged(model)

export const failedUpload = (
  model: Model,
  jobNumber: number,
  reason: string,
): UploadUpdate =>
  isWorking(model, jobNumber)
    ? {
        model: withJob(
          model,
          UploadJob.Refused({ name: nameOfJob(model), reason }),
        ),
        commands: [FocusUploadStatus()],
      }
    : unchanged(model)

export const clickedCancelUpload = (model: Model): UploadUpdate =>
  model.upload.job._tag === 'Working' &&
  model.upload.job.step._tag !== 'Keeping'
    ? {
        model: withJob(
          model,
          UploadJob.Cancelled({ name: File.name(model.upload.job.file) }),
        ),
        commands: [FocusUploadStatus()],
      }
    : unchanged(model)

// Leaving the screen cancels a cut under way. A clip already being kept
// is kept whole, though its lines do not open.
export const leftUpload = (model: Model): Model =>
  model.upload.job._tag === 'Working' ? withJob(model, UploadJob.Idle()) : model
