import { Effect, Option, Schema } from 'effect'
import { ManagedResource } from 'foldkit'

import {
  ClipAnalyser,
  ClipAnalyserError,
  type ClipEditing,
} from '../../services/clip-analyser'
import { ClipStore } from '../../services/clip-store'
import { HistoryStore } from '../../services/history-store'
import { Message } from '../message'
import type { Model } from '../model'

// The line editor's resource: the clip Worker holding the level's clip,
// decoded once from its kept file, from when the level is open with its
// audio on the device until it is left. Foldkit releases it the moment
// the Model leaves that state, and the Worker closes with the clip's
// audio. While held, it gives the waveform and tracks the lines a change
// moves (../../services/clip-analyser.ts, `edit`).

export type ClipEditorSession = Readonly<{ clipId: string }> & ClipEditing

export const ClipEditorResource =
  ManagedResource.tag<ClipEditorSession>()('ClipEditorResource')
export type ClipEditorResourceService = ManagedResource.ServiceOf<
  typeof ClipEditorResource
>

const reasonOf = (error: unknown): string =>
  error instanceof ClipAnalyserError
    ? error.reason
    : error instanceof Error
      ? error.message
      : String(error)

// The clip a level needs held: the level's, when it is an upload open
// with its audio on this device.
export const clipNeedingEditor = (model: Model): Option.Option<string> =>
  model.route._tag === 'Level' &&
  model.level._tag === 'Ready' &&
  model.level.clip.id === model.route.clipId &&
  model.level.clip.hasAudio &&
  model.level.clip.origin === 'Upload'
    ? Option.some(model.level.clip.id)
    : Option.none()

const missing = (reason: string) =>
  new ClipAnalyserError({ failure: 'Failed', reason })

export const levelResources = ManagedResource.make<Model, Message>()(entry => ({
  clipEditor: entry(Schema.Option(Schema.Struct({ clipId: Schema.String })), {
    resource: ClipEditorResource,
    modelToMaybeRequirements: model =>
      Option.map(clipNeedingEditor(model), clipId => ({ clipId })),
    acquire: ({ clipId }) =>
      Effect.gen(function* () {
        const history = yield* HistoryStore
        const files = yield* ClipStore
        const analyser = yield* ClipAnalyser
        const maybeClip = yield* history.clip(clipId)
        if (Option.isNone(maybeClip) || maybeClip.value.audio === null) {
          return yield* missing('The clip’s audio is not on this device.')
        }
        const audio = maybeClip.value.audio
        const maybeBytes = yield* files.read(audio.file)
        if (Option.isNone(maybeBytes)) {
          return yield* missing('The clip’s audio is no longer on this device.')
        }
        const editing = yield* analyser.edit(
          new Blob([Uint8Array.from(maybeBytes.value)], { type: audio.type }),
        )
        return { clipId, ...editing }
      }).pipe(
        Effect.provide([
          HistoryStore.layer,
          ClipStore.layer,
          ClipAnalyser.layer,
        ]),
      ),
    release: () => Effect.void,
    onAcquired: session =>
      Message.AcquiredClipEditor({
        clipId: session.clipId,
        peaks: session.peaks,
      }),
    onReleased: () => Message.ReleasedClipEditor(),
    onAcquireError: error =>
      Message.FailedAcquireClipEditor({ reason: reasonOf(error) }),
  }),
}))
