import { Option } from 'effect'
import { type File, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { FileDrop } from '@foldkit/ui'

import { ClipsPage } from '../level/level'
import { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import { FocusUploadStatus, OpenLevel } from './commands'
import { PackJob, PackStep, UploadJob } from './upload'

// The local pack's import on /upload: its files chosen, dropped or
// chosen as a folder start it, each step moves its progress on, and its
// end opens the level. One import or cut runs at a time, and the screen
// says what became of the last one alone, so its status is heard once.

type PackUpdate = Update.Return<Model, Message, AppResourceServices>

const unchanged = (model: Model): PackUpdate => ({ model })

const withPackJob = (model: Model, packJob: PackJob): Model =>
  modifyFields(model, {
    upload: upload => modifyFields(upload, { packJob: () => packJob }),
  })

const isWorking = (model: Model, jobNumber: number): boolean =>
  model.upload.packJob._tag === 'Working' &&
  model.upload.packJob.jobNumber === jobNumber

const refusedWith = (model: Model, reason: string): PackUpdate => ({
  model: withPackJob(model, PackJob.Refused({ reason })),
  commands: [FocusUploadStatus()],
})

const started = (model: Model, files: ReadonlyArray<File.File>): PackUpdate => {
  if (
    model.upload.packJob._tag === 'Working' ||
    model.upload.job._tag === 'Working'
  ) {
    return unchanged(model)
  }
  const jobNumber = model.upload.jobsStarted + 1
  return {
    model: modifyFields(model, {
      upload: upload =>
        modifyFields(upload, {
          jobsStarted: () => jobNumber,
          job: () => UploadJob.Idle(),
          packJob: () =>
            PackJob.Working({ jobNumber, files, step: PackStep.Reading() }),
        }),
    }),
    commands: [FocusUploadStatus()],
  }
}

const foldPackOutMessage = FileDrop.OutMessage.match<
  Update.Step<Model, Message, AppResourceServices>
>({
  ReceivedFiles:
    ({ files }) =>
    model =>
      started(model, files),
  RejectedNonFiles: () => model =>
    refusedWith(
      model,
      'Only files can be dropped here: choose or drop pack.json with its audio files.',
    ),
})

export const foldPackDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.upload.packDrop),
  write: (model: Model, next: FileDrop.Model) =>
    modifyFields(model, {
      upload: upload => modifyFields(upload, { packDrop: () => next }),
    }),
  toParentMessage: (message: FileDrop.Message) =>
    Message.GotPackDropMessage({ message }),
  foldOutMessage: foldPackOutMessage,
})

export const foldPackFolder = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.upload.packFolder),
  write: (model: Model, next: FileDrop.Model) =>
    modifyFields(model, {
      upload: upload => modifyFields(upload, { packFolder: () => next }),
    }),
  toParentMessage: (message: FileDrop.Message) =>
    Message.GotPackFolderMessage({ message }),
  foldOutMessage: foldPackOutMessage,
})

export const progressedPackImport = (
  model: Model,
  jobNumber: number,
  step: PackStep,
): PackUpdate =>
  model.upload.packJob._tag === 'Working' && isWorking(model, jobNumber)
    ? {
        model: withPackJob(
          model,
          PackJob.Working({ ...model.upload.packJob, step }),
        ),
      }
    : unchanged(model)

// The pack is kept: its level opens, and the home screen's list will be
// read again.
export const succeededPackImport = (
  model: Model,
  jobNumber: number,
  clipId: string,
): PackUpdate =>
  isWorking(model, jobNumber)
    ? {
        model: modifyFields(withPackJob(model, PackJob.Idle()), {
          clips: () => ClipsPage.NotLoaded(),
        }),
        commands: [OpenLevel({ clipId })],
      }
    : unchanged(model)

export const failedPackImport = (
  model: Model,
  jobNumber: number,
  reason: string,
): PackUpdate =>
  isWorking(model, jobNumber) ? refusedWith(model, reason) : unchanged(model)

export const clickedCancelPackImport = (model: Model): PackUpdate =>
  model.upload.packJob._tag === 'Working' &&
  model.upload.packJob.step._tag !== 'Keeping'
    ? {
        model: withPackJob(model, PackJob.Cancelled()),
        commands: [FocusUploadStatus()],
      }
    : unchanged(model)

// Leaving the screen stops an import under way; one already keeping is
// kept whole, though its level does not open.
export const leftPackImport = (model: Model): Model =>
  model.upload.packJob._tag === 'Working'
    ? withPackJob(model, PackJob.Idle())
    : model
