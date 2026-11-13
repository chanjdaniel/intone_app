import { Array, Effect, Option, Schema, pipe } from 'effect'
import { Command, Dom } from 'foldkit'
import { pushUrl, replaceUrl } from 'foldkit/navigation'

import { type ClipEntry, lineAudioOf } from '../../services/history-records'
import { type HistoryError, HistoryStore } from '../../services/history-store'
import { LineAsKept, lineProgressOf } from '../history/history'
import {
  type BundledClip,
  bundledClipOf,
  bundledClips,
  clipLineTitle,
} from '../line/lines'
import type { NextLine } from '../line/place'
import { Message } from '../message'
import { homeRouter, levelRouter } from '../route'
import { clipSummaryOf, levelClipOf, levelClipOfBundled } from './level'

// Reading the learner's clips from the device, for the home screen.
export const LoadClips = Command.define('LoadClips', {
  messages: [Message.SucceededLoadClips, Message.FailedLoadClips],
  execute: Effect.gen(function* () {
    const history = yield* HistoryStore
    const { clips } = yield* history.clips
    return Message.SucceededLoadClips({ clips: clips.map(clipSummaryOf) })
  }).pipe(
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadClips({ reason: error.reason })),
    ),
  ),
})

// A level's lines as its stars and its next line need them: what each
// is called, whether it can be copied, and what the device holds of it
// (../history/history.ts, `LineAsKept`); a clip the app brings, or one
// of the learner's, or none.
export type LevelSourceLine = Readonly<{
  lineId: string
  title: string
  titleIsText: boolean
  copyable: boolean
  asKept: LineAsKept
}>
export type LevelSource = Readonly<{
  name: string
  lines: ReadonlyArray<LevelSourceLine>
}>

export const sourceOfClip = (clip: ClipEntry): LevelSource => ({
  name: clip.name,
  lines: clip.lines.map((line, k) => {
    const text = line.text?.trim() ?? ''
    return {
      lineId: line.id,
      title: text === '' ? clipLineTitle(k + 1) : text,
      titleIsText: text !== '',
      copyable:
        line.native._tag === 'Tracked' && lineAudioOf(clip, line) !== null,
      asKept: LineAsKept.Current({
        maybeNativeId:
          line.native._tag === 'Tracked'
            ? Option.some(line.native.nativeId)
            : Option.none(),
      }),
    }
  }),
})

const sourceOfBundled = (clip: BundledClip): LevelSource => ({
  name: clip.name,
  lines: clip.lines.map(line => ({
    lineId: line.lineId,
    title: line.text,
    titleIsText: true,
    copyable: true,
    asKept: LineAsKept.Bundled(),
  })),
})

export const levelSourceOf = (
  history: HistoryStore['Service'],
  clipId: string,
): Effect.Effect<Option.Option<LevelSource>, HistoryError> =>
  Option.match(bundledClipOf(clipId), {
    onSome: clip => Effect.succeedSome(sourceOfBundled(clip)),
    onNone: () =>
      history.clip(clipId).pipe(Effect.map(Option.map(sourceOfClip))),
  })

// Every level's lines: the clips the app brings, then the learner's.
export const levelSourcesOf = (
  history: HistoryStore['Service'],
): Effect.Effect<
  ReadonlyArray<Readonly<{ clipId: string; source: LevelSource }>>,
  HistoryError
> =>
  history.clips.pipe(
    Effect.map(({ clips }) => [
      ...bundledClips.map(clip => ({
        clipId: clip.id,
        source: sourceOfBundled(clip),
      })),
      ...clips.map(clip => ({ clipId: clip.id, source: sourceOfClip(clip) })),
    ]),
  )

// The line after `lineId` in its level that can be copied.
export const nextLineOf = (
  source: LevelSource,
  lineId: string,
): Option.Option<NextLine> =>
  pipe(
    Array.findFirstIndex(source.lines, line => line.lineId === lineId),
    Option.flatMap(index =>
      Array.findFirst(source.lines.slice(index + 1), line => line.copyable),
    ),
    Option.map(({ lineId: next, title, titleIsText }) => ({
      lineId: next,
      title,
      titleIsText,
    })),
  )

// Reading one clip and its lines, for its level: one the app brings, or
// one of the learner's from the device.
export const LoadLevel = Command.define('LoadLevel', {
  args: { clipId: Schema.String },
  messages: [Message.SucceededLoadLevel, Message.FailedLoadLevel],
  execute: ({ clipId }) =>
    Effect.gen(function* () {
      const maybeBundled = bundledClipOf(clipId)
      if (Option.isSome(maybeBundled)) {
        return Message.SucceededLoadLevel({
          clipId,
          maybeClip: Option.some(levelClipOfBundled(maybeBundled.value)),
        })
      }
      const history = yield* HistoryStore
      const maybeClip = yield* history.clip(clipId)
      return Message.SucceededLoadLevel({
        clipId,
        maybeClip: Option.map(maybeClip, levelClipOf),
      })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedLoadLevel({ clipId, reason: error.reason }),
        ),
      ),
    ),
})

// Reading a level's stars from the takes kept on the device.
export const LoadLevelStars = Command.define('LoadLevelStars', {
  args: { clipId: Schema.String },
  messages: [Message.SucceededLoadLevelStars, Message.FailedLoadLevelStars],
  execute: ({ clipId }) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      const maybeSource = yield* levelSourceOf(history, clipId)
      const { entries } = yield* history.entries
      return Message.SucceededLoadLevelStars({
        clipId,
        lines: Option.match(maybeSource, {
          onNone: () => [],
          onSome: source =>
            source.lines.map(line => ({
              lineId: line.lineId,
              progress: lineProgressOf(
                entries,
                clipId,
                line.lineId,
                line.asKept,
              ),
            })),
        }),
      })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedLoadLevelStars({ clipId, reason: error.reason }),
        ),
      ),
    ),
})

// Writes the find words to the address as they are typed.
export const ReplaceLevelFind = Command.define('ReplaceLevelFind', {
  args: { clipId: Schema.String, words: Schema.String },
  messages: [Message.CompletedReplaceLevelFind],
  execute: ({ clipId, words }) =>
    replaceUrl(
      levelRouter({
        clipId,
        maybeFind: words === '' ? Option.none() : Option.some(words),
      }),
    ).pipe(Effect.as(Message.CompletedReplaceLevelFind())),
})

export const levelRowAttribute = 'level-row'

// Puts focus on the list's row `index`, the first of those just shown.
export const FocusLevelRow = Command.define('FocusLevelRow', {
  args: { index: Schema.Finite },
  messages: [Message.CompletedFocusLevelRow],
  execute: ({ index }) =>
    Dom.focus(`[data-${levelRowAttribute}="${index}"]`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusLevelRow()),
    ),
})

// Deletes the clip with all its lines, their curves, its takes and its
// files.
export const DeleteClip = Command.define('DeleteClip', {
  args: { clipId: Schema.String, name: Schema.String },
  messages: [Message.SucceededDeleteClip, Message.FailedDeleteClip],
  execute: ({ clipId, name }) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      yield* history.removeClip(clipId)
      return Message.SucceededDeleteClip({ clipId, name })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedDeleteClip({ clipId, reason: error.reason }),
        ),
      ),
    ),
})

export const GoHome = Command.define('GoHome', {
  messages: [Message.CompletedGoHome],
  execute: pushUrl(homeRouter({ maybeFind: Option.none() })).pipe(
    Effect.as(Message.CompletedGoHome()),
  ),
})
