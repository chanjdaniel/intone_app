import { Schema } from 'effect'
import { File } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'

import { FileDrop } from '@foldkit/ui'

// The upload screen's part of the Model: the drop zone, and the clip
// being cut into lines (./subscriptions.ts), a step at a time. The file
// itself is held while it is cut, and let go once its lines are kept or
// the cut is cancelled; the lines and their curves go from the clip
// Worker to the device, never into the Model.

export const UploadStep = defineTaggedUnion({
  // Reading the file's length from its header.
  Checking: {},
  Decoding: {},
  // `done` of `total` 32 ms windows searched for speech.
  FindingLines: { done: Schema.Finite, total: Schema.Finite },
  // `done` of `total` lines' pitch found.
  TrackingLines: { done: Schema.Finite, total: Schema.Finite },
  // Keeping the clip and its lines on the device.
  Keeping: {},
})
export type UploadStep = typeof UploadStep.Type

// The file being cut, as the browser gave it.
// NOTE: `File.File` from foldkit is typed as a Schema that may need any
// service to decode, which the Model's own Schema cannot; this one needs
// none.
const ChosenFile = Schema.instanceOf(globalThis.File)

export const UploadJob = defineTaggedUnion({
  Idle: {},
  // Each job is numbered, so a late step of a cancelled one is told
  // apart from the one running now.
  Working: { jobNumber: Schema.Finite, file: ChosenFile, step: UploadStep },
  // The file could not be used, and why, in a sentence for the learner.
  Refused: { name: Schema.String, reason: Schema.String },
  Cancelled: { name: Schema.String },
})
export type UploadJob = typeof UploadJob.Type

// A local pack being imported (../../services/local-pack.ts): its
// manifest and audio files, chosen together or as their folder.
export const PackStep = defineTaggedUnion({
  Reading: {},
  // `done` of `total` files read and checked.
  CheckingFiles: { done: Schema.Finite, total: Schema.Finite },
  // `done` of `total` new lines' pitch found.
  TrackingLines: { done: Schema.Finite, total: Schema.Finite },
  Keeping: {},
})
export type PackStep = typeof PackStep.Type

export const PackJob = defineTaggedUnion({
  Idle: {},
  Working: {
    jobNumber: Schema.Finite,
    files: Schema.Array(ChosenFile),
    step: PackStep,
  },
  Refused: { reason: Schema.String },
  Cancelled: {},
})
export type PackJob = typeof PackJob.Type

export const UploadPage = Schema.Struct({
  fileDrop: FileDrop.Model,
  job: UploadJob,
  jobsStarted: Schema.Finite,
  // The local pack's files, chosen or dropped, or its folder chosen.
  packDrop: FileDrop.Model,
  packFolder: FileDrop.Model,
  packJob: PackJob,
})
export type UploadPage = typeof UploadPage.Type

export const fileDropId = 'upload-file'
export const packDropId = 'pack-files'
export const packFolderId = 'pack-folder'

export const initialUpload: UploadPage = {
  fileDrop: FileDrop.init({ id: fileDropId }),
  job: UploadJob.Idle(),
  jobsStarted: 0,
  packDrop: FileDrop.init({ id: packDropId }),
  packFolder: FileDrop.init({ id: packFolderId }),
  packJob: PackJob.Idle(),
}

// Whether this browser lets a page choose a folder.
export const canChooseFolder: boolean =
  typeof HTMLInputElement !== 'undefined' &&
  'webkitdirectory' in HTMLInputElement.prototype

export const packProgressOf = (step: PackStep): number =>
  PackStep.match(step, {
    Reading: () => 0,
    CheckingFiles: ({ done, total }) =>
      0.02 + 0.08 * (total === 0 ? 1 : done / total),
    TrackingLines: ({ done, total }) =>
      0.1 + 0.85 * (total === 0 ? 1 : done / total),
    Keeping: () => 0.97,
  })

export const packStepText = (step: PackStep): string =>
  PackStep.match(step, {
    Reading: () => 'Reading pack.json.',
    CheckingFiles: ({ done, total }) =>
      `Reading the pack’s audio files: ${done} of ${total}.`,
    TrackingLines: ({ done, total }) =>
      `Finding the pitch of each new line: ${done} of ${total}.`,
    Keeping: () => 'Keeping the pack and its lines on this device.',
  })

// What the file picker offers: audio of any kind, and the containers a
// recording often comes in, by their extensions, for a browser that
// does not name their media type.
export const acceptedFiles: ReadonlyArray<string> = [
  'audio/*',
  'video/mp4',
  'video/webm',
  '.m4a',
  '.aac',
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.webm',
]

// Media types that hold sound without saying so: Firefox names an Ogg
// file `application/ogg`, and a browser that cannot tell names a file
// `application/octet-stream`; the decoder decides those.
const soundContainers: ReadonlyArray<string> = [
  'application/ogg',
  'application/octet-stream',
]

// Why a file is refused before it is read, if it is: it names itself as
// something other than sound, or holds nothing.
export const refusalOf = (file: File.File): string | null => {
  const type = File.mimeType(file)
  if (File.size(file) === 0) {
    return 'The file is empty.'
  }
  if (
    type !== '' &&
    !type.startsWith('audio/') &&
    !type.startsWith('video/') &&
    !soundContainers.includes(type)
  ) {
    return 'It is not an audio file. Choose a recording, such as a WAV, MP3 or M4A file.'
  }
  return null
}

// How far along a step is, from 0 to 1, for the progress bar: finding the
// lines takes about a third of the time and their pitch the rest
// (docs/uploads.md).
export const progressOf = (step: UploadStep): number =>
  UploadStep.match(step, {
    Checking: () => 0,
    Decoding: () => 0.03,
    FindingLines: ({ done, total }) =>
      0.05 + 0.3 * (total === 0 ? 1 : done / total),
    TrackingLines: ({ done, total }) =>
      0.35 + 0.6 * (total === 0 ? 1 : done / total),
    Keeping: () => 0.97,
  })

export const stepText = (step: UploadStep): string =>
  UploadStep.match(step, {
    Checking: () => 'Reading the file.',
    Decoding: () => 'Decoding the audio.',
    FindingLines: ({ done, total }) =>
      `Finding where each line starts and ends: ${Math.floor((100 * done) / Math.max(1, total))}%.`,
    TrackingLines: ({ done, total }) =>
      `Finding each line’s pitch: ${done} of ${total}.`,
    Keeping: () => 'Keeping the clip and its lines on this device.',
  })
