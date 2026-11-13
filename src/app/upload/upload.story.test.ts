import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { FileDrop } from '@foldkit/ui'

import { LoadClips, LoadLevel, LoadLevelStars } from '../level/commands'
import { ClipWaveform } from '../level/editor'
import { ClipsPage } from '../level/level'
import { sampleClip } from '../level/testClips'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { LoadDueLines } from '../returns/commands'
import { FocusUploadStatus, OpenLevel } from './commands'
import { uploadJobOf } from './subscriptions'
import { UploadJob, UploadStep, progressOf } from './upload'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const onUpload = (): Model => initialModel(AppRoute.Upload())

const audioFile = new File([new Uint8Array(64)], 'reading.mp3', {
  type: 'audio/mpeg',
})

const dropped = (file: File) =>
  Message.GotUploadDropMessage({
    message: FileDrop.Message.DroppedFiles({ files: [file] }),
  })

const working = (step: UploadStep = UploadStep.Checking()): Model => ({
  ...onUpload(),
  upload: {
    ...onUpload().upload,
    jobsStarted: 1,
    job: UploadJob.Working({ jobNumber: 1, file: audioFile, step }),
  },
})

describe('choosing a file', () => {
  test('a dropped or chosen audio file starts its cut, and the cut runs while it works', () => {
    story(
      update,
      given(onUpload()),
      message(dropped(audioFile)),
      Command.expectExact(FocusUploadStatus()),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => {
        expect(current.upload.job).toStrictEqual(
          UploadJob.Working({
            jobNumber: 1,
            file: audioFile,
            step: UploadStep.Checking(),
          }),
        )
        expect(uploadJobOf(current)).toStrictEqual(
          Option.some({ jobNumber: 1, file: audioFile }),
        )
      }),
    )
  })

  test('a file that names itself as something other than sound is refused, by name, before it is read', () => {
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    story(
      update,
      given(onUpload()),
      message(dropped(notes)),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => {
        expect(current.upload.job).toStrictEqual(
          UploadJob.Refused({
            name: 'notes.txt',
            reason:
              'It is not an audio file. Choose a recording, such as a WAV, MP3 or M4A file.',
          }),
        )
        expect(uploadJobOf(current)).toStrictEqual(Option.none())
      }),
    )
  })

  test('an Ogg file is tried, as Firefox names it application/ogg', () => {
    story(
      update,
      given(onUpload()),
      message(
        dropped(
          new File([new Uint8Array(8)], 'reading.ogg', {
            type: 'application/ogg',
          }),
        ),
      ),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => expect(current.upload.job._tag).toBe('Working')),
    )
  })

  test('an empty file is refused', () => {
    story(
      update,
      given(onUpload()),
      message(dropped(new File([], 'empty.wav', { type: 'audio/wav' }))),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current =>
        expect(current.upload.job).toStrictEqual(
          UploadJob.Refused({
            name: 'empty.wav',
            reason: 'The file is empty.',
          }),
        ),
      ),
    )
  })

  test('a file with no media type is tried, since the decoder decides', () => {
    story(
      update,
      given(onUpload()),
      message(dropped(new File([new Uint8Array(8)], 'phone recording'))),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => expect(current.upload.job._tag).toBe('Working')),
    )
  })

  test('a drop with no file in it says so', () => {
    story(
      update,
      given(onUpload()),
      message(
        Message.GotUploadDropMessage({
          message: FileDrop.Message.DroppedNonFiles(),
        }),
      ),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => expect(current.upload.job._tag).toBe('Refused')),
    )
  })

  test('a second file while one is being cut is left alone', () => {
    story(
      update,
      given(working()),
      message(dropped(new File([new Uint8Array(8)], 'other.wav'))),
      model(current =>
        expect(current.upload.job).toStrictEqual(working().upload.job),
      ),
    )
  })
})

describe('the cut', () => {
  test('each step moves the progress on, and a step of another job changes nothing', () => {
    const step = UploadStep.TrackingLines({ done: 3, total: 9 })
    story(
      update,
      given(working()),
      message(Message.ProgressedUpload({ jobNumber: 1, step })),
      model(current =>
        expect(current.upload.job).toMatchObject({ _tag: 'Working', step }),
      ),
      message(
        Message.ProgressedUpload({
          jobNumber: 7,
          step: UploadStep.Keeping(),
        }),
      ),
      model(current =>
        expect(current.upload.job).toMatchObject({ _tag: 'Working', step }),
      ),
    )
  })

  test('the progress only moves forward, step by step', () => {
    const steps = [
      UploadStep.Checking(),
      UploadStep.Decoding(),
      UploadStep.FindingLines({ done: 0, total: 100 }),
      UploadStep.FindingLines({ done: 100, total: 100 }),
      UploadStep.TrackingLines({ done: 0, total: 9 }),
      UploadStep.TrackingLines({ done: 9, total: 9 }),
      UploadStep.Keeping(),
    ]
    const shares = steps.map(progressOf)
    shares.forEach((share, k) => {
      expect(share).toBeGreaterThanOrEqual(shares[k - 1] ?? 0)
      expect(share).toBeLessThan(1)
    })
  })

  test('once the clip is kept, its lines open and the home screen reads its clips again', () => {
    story(
      update,
      given({ ...working(), clips: ClipsPage.Ready({ clips: [] }) }),
      message(Message.SucceededUpload({ jobNumber: 1, clipId: 'c1' })),
      Command.expectExact(OpenLevel({ clipId: 'c1' })),
      Command.resolve(OpenLevel, Message.CompletedOpenLevel()),
      model(current => {
        expect(current.upload.job).toStrictEqual(UploadJob.Idle())
        expect(current.clips).toStrictEqual(ClipsPage.NotLoaded())
      }),
    )
  })

  test('the clip’s level opens with its line editor open, the cut’s likeliest next step', () => {
    const clip = sampleClip(3)
    story(
      update,
      given(working()),
      message(Message.SucceededUpload({ jobNumber: 1, clipId: 'c1' })),
      Command.resolve(OpenLevel, Message.CompletedOpenLevel()),
      message(Message.ChangedUrl({ url: url('/level/c1') })),
      Command.expectExact(LoadLevel({ clipId: 'c1' })),
      Command.resolve(
        LoadLevel,
        Message.SucceededLoadLevel({
          clipId: 'c1',
          maybeClip: Option.some(clip),
        }),
      ),
      Command.resolve(
        LoadLevelStars,
        Message.SucceededLoadLevelStars({ clipId: 'c1', lines: [] }),
      ),
      model(current =>
        expect(current.level).toMatchObject({
          editor: { waveform: ClipWaveform.Opening() },
        }),
      ),
    )
  })

  test('a cut that fails names the file and says why', () => {
    story(
      update,
      given(working()),
      message(
        Message.FailedUpload({
          jobNumber: 1,
          reason: 'It is 12:00 long, and a clip can be at most 10 minutes.',
        }),
      ),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current =>
        expect(current.upload.job).toStrictEqual(
          UploadJob.Refused({
            name: 'reading.mp3',
            reason: 'It is 12:00 long, and a clip can be at most 10 minutes.',
          }),
        ),
      ),
    )
  })

  test('stopping cancels the cut, so its Stream ends, and a late end of it changes nothing', () => {
    story(
      update,
      given(working(UploadStep.FindingLines({ done: 4, total: 9 }))),
      message(Message.ClickedCancelUpload()),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current => {
        expect(current.upload.job).toStrictEqual(
          UploadJob.Cancelled({ name: 'reading.mp3' }),
        )
        expect(uploadJobOf(current)).toStrictEqual(Option.none())
      }),
      message(Message.SucceededUpload({ jobNumber: 1, clipId: 'c1' })),
      model(current => expect(current.upload.job._tag).toBe('Cancelled')),
    )
  })

  test('a clip already being kept cannot be stopped', () => {
    story(
      update,
      given(working(UploadStep.Keeping())),
      message(Message.ClickedCancelUpload()),
      model(current => expect(current.upload.job._tag).toBe('Working')),
    )
  })

  test('leaving the screen cancels the cut', () => {
    story(
      update,
      given(working(UploadStep.Decoding())),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      Command.resolve(
        LoadDueLines,
        Message.SucceededLoadDueLines({
          today: '2026-11-10',
          lines: [],
          maybeNextOn: Option.none(),
        }),
      ),
      model(current => {
        expect(current.upload.job).toStrictEqual(UploadJob.Idle())
        expect(uploadJobOf(current)).toStrictEqual(Option.none())
      }),
    )
  })

  test('the next file is a job of its own', () => {
    story(
      update,
      given({
        ...onUpload(),
        upload: {
          ...onUpload().upload,
          jobsStarted: 4,
          job: UploadJob.Cancelled({ name: 'a.wav' }),
        },
      }),
      message(dropped(audioFile)),
      Command.resolve(FocusUploadStatus, Message.CompletedFocusUploadStatus()),
      model(current =>
        expect(current.upload.job).toMatchObject({
          _tag: 'Working',
          jobNumber: 5,
        }),
      ),
    )
  })
})
