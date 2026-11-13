import { Option } from 'effect'

import type { ClipEntry } from '../../services/history-records'
import type { LevelClip, LevelLine } from './level'

// A clip as the Model knows it, with `count` lines of about 2.5 s each,
// for the app's own tests; nothing in the app imports it.
export const sampleClip = (count: number, hasAudio = true): LevelClip => ({
  id: 'c1',
  name: 'reading.mp3',
  seconds: count * 3 + 1,
  addedAt: 1_000,
  hasAudio,
  lines: Array.from({ length: count }, (_, k): LevelLine => ({
    id: String(k + 1),
    number: k + 1,
    from: k * 3 + 0.4,
    to: k * 3 + 2.9,
    native: k === 1 ? 'TooQuiet' : 'Tracked',
    maybeQuality:
      k === 1
        ? Option.none()
        : Option.some({
            speechFrames: 120,
            confidentShare: 0.68,
            pauseFrames: 18,
            pausePitchedShare: 0,
          }),
    ...noPackFields,
  })),
  maybeUndo: Option.none(),
  origin: 'Upload',
  maybeWrittenBy: Option.none(),
})

// What a line of an upload has none of.
export const noPackFields = {
  maybeFile: Option.none(),
  maybeText: Option.none(),
  maybeKana: Option.none(),
  maybeSource: Option.none(),
  maybeDetail: Option.none(),
} as const

// A level imported from the local pack, as the history keeps it: a line
// with text, kana and a source link, one with text alone, and one with
// none, for the app's own tests.
export const samplePack: ClipEntry = {
  format: 1,
  id: 'pack-example',
  name: 'Example local pack',
  addedAt: 1_000,
  seconds: 13,
  audio: null,
  lines: [
    {
      id: '1',
      file: 'audio/hashi.wav',
      from: 0,
      to: 1.63,
      native: { _tag: 'Tracked', nativeId: 'n1' },
      text: '橋を渡ります',
      kana: 'はしをわたります',
      source: {
        url: 'https://www.youtube.com/watch?v=planted',
        from: 12.5,
        to: 14.1,
      },
    },
    {
      id: '2',
      file: 'audio/kyou.wav',
      from: 0,
      to: 3.4,
      native: { _tag: 'Tracked', nativeId: 'n2' },
      text: '今日は駅で古い友達に会いました',
    },
    {
      id: '3',
      file: 'audio/gongitsune.wav',
      from: 0.68,
      to: 3.69,
      native: { _tag: 'Tracked', nativeId: 'n3' },
    },
  ],
  nextLineId: 4,
  pack: {
    id: 'example',
    files: [
      {
        path: 'audio/hashi.wav',
        sha256: 'a'.repeat(64),
        seconds: 1.63,
        audio: {
          file: `clips/pack-example-${'a'.repeat(16)}.wav`,
          type: 'audio/wav',
          bytes: 78_380,
        },
      },
      {
        path: 'audio/kyou.wav',
        sha256: 'b'.repeat(64),
        seconds: 3.4,
        audio: {
          file: `clips/pack-example-${'b'.repeat(16)}.wav`,
          type: 'audio/wav',
          bytes: 163_372,
        },
      },
      {
        path: 'audio/gongitsune.wav',
        sha256: 'c'.repeat(64),
        seconds: 8,
        audio: {
          file: `clips/pack-example-${'c'.repeat(16)}.wav`,
          type: 'audio/wav',
          bytes: 352_844,
        },
      },
    ],
  },
}
