import { Array, Option } from 'effect'

import ameGaSukiAudio from '../../../fixtures/voices/ame-ga-suki/meimei-himari/right.wav?url'

// The lines the app brings with it. For now one: 雨が好き, in VOICEVOX's
// 冥鳴ひまり with its right Tokyo accent, from the labelled fixtures
// (fixtures/README.md), whose terms ask for the credit shown with it.
// Each line here is its whole clip, from the file's first sample to its
// last; the tracker finds where the voice starts.

export type BundledLine = Readonly<{
  clipId: string
  lineId: string
  // The line as written, and its reading in kana.
  text: string
  reading: string
  // Who or what is speaking, as the voice's terms ask it to be credited.
  credit: string
  // The clip's audio, from the app's own origin.
  audioUrl: string
}>

export const bundledLines: ReadonlyArray<BundledLine> = [
  {
    clipId: 'ame-ga-suki',
    lineId: '1',
    text: '雨が好き',
    reading: 'あめがすき',
    credit: 'VOICEVOX:冥鳴ひまり',
    audioUrl: ameGaSukiAudio,
  },
]

export const lineOf = (
  clipId: string,
  lineId: string,
): Option.Option<BundledLine> =>
  Array.findFirst(
    bundledLines,
    line => line.clipId === clipId && line.lineId === lineId,
  )

// The key a line is known by on the device.
export const lineKey = (line: Pick<BundledLine, 'clipId' | 'lineId'>): string =>
  `${line.clipId}/${line.lineId}`
