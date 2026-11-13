import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import ameGaSukiAudio from '../../../fixtures/voices/ame-ga-suki/meimei-himari/right.wav?url'
import {
  type ClipAudio,
  type ClipEntry,
  type ClipLine,
  type LineSource,
  clipLineTexts,
} from '../../services/history-records'

// The lines to copy: those the app brings with it, and those of the
// clips the learner brings (../upload/). For now the app brings one:
// 雨が好き, in VOICEVOX's 冥鳴ひまり with its right Tokyo accent, from the
// labelled fixtures (fixtures/README.md), whose terms ask for the credit
// shown with it. A bundled line is its whole clip, from the file's first
// sample to its last; a line of the learner's clip is a stretch of it.
// Either way the tracker finds where the voice starts.

export type BundledLine = Readonly<{
  clipId: string
  lineId: string
  // The line as written, and its reading in kana.
  text: string
  reading: string
  // Who or what is speaking, as the voice's terms ask it to be credited.
  credit: string
  // The clip's audio, from the app's own origin, and how long it is.
  audioUrl: string
  seconds: number
}>

// A level the app brings: a clip of its own and its lines, in order.
export type BundledClip = Readonly<{
  id: string
  name: string
  lines: ReadonlyArray<BundledLine>
}>

export const bundledClips: ReadonlyArray<BundledClip> = [
  {
    id: 'ame-ga-suki',
    name: '雨が好き',
    lines: [
      {
        clipId: 'ame-ga-suki',
        lineId: '1',
        text: '雨が好き',
        reading: 'あめがすき',
        credit: 'VOICEVOX:冥鳴ひまり',
        audioUrl: ameGaSukiAudio,
        seconds: 30464 / 24000,
      },
    ],
  },
]

export const bundledLines: ReadonlyArray<BundledLine> = bundledClips.flatMap(
  clip => clip.lines,
)

export const bundledClipOf = (clipId: string): Option.Option<BundledClip> =>
  Array.findFirst(bundledClips, clip => clip.id === clipId)

export const lineOf = (
  clipId: string,
  lineId: string,
): Option.Option<BundledLine> =>
  Array.findFirst(
    bundledLines,
    line => line.clipId === clipId && line.lineId === lineId,
  )

// The key a line is known by on the device.
export const lineKey = (line: Readonly<{ clipId: string; lineId: string }>) =>
  `${line.clipId}/${line.lineId}`

// Where a line's audio is: a bundled file on the app's own origin, or a
// stretch of the learner's clip in the clip store, in seconds from its
// start.
export const LineAudio = defineTaggedUnion({
  Bundled: { url: Schema.String },
  Clip: {
    file: Schema.String,
    type: Schema.String,
    from: Schema.Finite,
    to: Schema.Finite,
  },
})
export type LineAudio = typeof LineAudio.Type

// Where a line of the local pack came from: a link, never fetched, and
// the times in it.
export const SourceLink = Schema.Struct({
  url: Schema.String,
  maybeFrom: Schema.Option(Schema.Finite),
  maybeTo: Schema.Option(Schema.Finite),
})
export type SourceLink = typeof SourceLink.Type

export const sourceLinkOf = (source: LineSource): SourceLink => ({
  url: source.url,
  maybeFrom: Option.fromNullishOr(source.from),
  maybeTo: Option.fromNullishOr(source.to),
})

// A line as its practice screen shows it.
export const PracticeLine = Schema.Struct({
  clipId: Schema.String,
  lineId: Schema.String,
  // The line as written, or its name when it has no text yet.
  title: Schema.String,
  // Whether the title is Japanese text, read as such.
  titleIsText: Schema.Boolean,
  // Its reading in kana, or where it is in its clip.
  detail: Schema.String,
  // Whether the detail is Japanese text, read as such.
  detailIsText: Schema.Boolean,
  // What the screen's footer says of the voice.
  credit: Schema.String,
  // What the history calls it, after its clip may be gone.
  historyText: Schema.String,
  audio: LineAudio,
  // Where a line of the local pack came from, when its manifest says.
  maybeSource: Schema.Option(SourceLink),
})
export type PracticeLine = typeof PracticeLine.Type

export const practiceLineOfBundled = (line: BundledLine): PracticeLine => ({
  clipId: line.clipId,
  lineId: line.lineId,
  title: line.text,
  titleIsText: true,
  detail: line.reading,
  detailIsText: true,
  credit: `Voice: ${line.credit}, made with VOICEVOX.`,
  historyText: line.text,
  audio: LineAudio.Bundled({ url: line.audioUrl }),
  maybeSource: Option.none(),
})

// Minutes and seconds, as 1:05, and tenths of a second under a minute's
// line, as 0:05.3.
// A time a hair under a tenth, as 14.1 is in floating point, is read as
// that tenth.
export const clockText = (seconds: number, tenths = false): string => {
  const inTenths = Math.floor(seconds * 10 + 1e-6)
  const whole = Math.floor(inTenths / 10)
  const minutes = Math.floor(whole / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return tenths ? `${minutes}:${rest}.${inTenths % 10}` : `${minutes}:${rest}`
}

// Minutes, seconds and hundredths, as 1:05.32: the line editor's 10 ms
// steps.
export const preciseClockText = (seconds: number): string => {
  const hundredths = Math.round(seconds * 100)
  const whole = Math.floor(hundredths / 100)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`
}

// A line of a clip is named by its place in the clip, counting from 1.
export const clipLineTitle = (number: number): string => `Line ${number}`

// Where a line is: its clip, or its file in the local pack, and its times.
export const clipLineDetail = (
  clip: Pick<ClipEntry, 'name'>,
  line: Pick<ClipLine, 'from' | 'to' | 'file'>,
): string =>
  `${line.file ?? clip.name}, ${clockText(line.from, true)} to ${clockText(line.to, true)}`

// A line of the learner's clip or of their local pack, whose audio is on
// this device: called by its text when it has one (its manifest's, the
// learner's own, or its words in the clip's transcript), else by its
// place.
export const practiceLineOfClip = (
  clip: ClipEntry,
  line: ClipLine,
  audio: ClipAudio,
): PracticeLine => {
  const place = clip.lines.findIndex(found => found.id === line.id)
  const name = clipLineTitle(place + 1)
  const text = (clipLineTexts(clip)[place] ?? line.text ?? '').trim()
  return {
    clipId: clip.id,
    lineId: line.id,
    title: text === '' ? name : text,
    titleIsText: text !== '',
    detail: line.kana ?? clipLineDetail(clip, line),
    detailIsText: line.kana !== undefined,
    credit:
      clip.pack === undefined
        ? 'From your own clip, kept on this device.'
        : 'From your local pack, kept on this device.',
    historyText: text === '' ? `${clip.name}, ${name.toLowerCase()}` : text,
    maybeSource: Option.map(Option.fromNullishOr(line.source), sourceLinkOf),
    audio: LineAudio.Clip({
      file: audio.file,
      type: audio.type,
      from: line.from,
      to: line.to,
    }),
  }
}
