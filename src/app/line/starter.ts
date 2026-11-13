import { Schema } from 'effect'

import {
  type StarterCredit,
  StarterPack,
  type StarterPackLine,
} from '../../services/starter-records'

// The starter set (docs/starter-set.md): the levels and lines
// scripts/starter-pack.ts writes to starter/pack/, read here as the
// app's own data, decoded by the pack's Schema when the app loads. Each
// line's file reaches the app through Vite's asset handling, as a hashed
// /assets/ path the servers keep for good; only its address is in the
// entry chunk, and the browser fetches the file when the line opens.

const packModules = import.meta.glob('../../../starter/pack/levels.json', {
  eager: true,
  import: 'default',
})

const audioUrls: Readonly<Record<string, string>> = import.meta.glob(
  '../../../starter/pack/audio/*.wav',
  { eager: true, query: '?url', import: 'default' },
)

export const starterPack: StarterPack = Schema.decodeUnknownSync(StarterPack)(
  packModules['../../../starter/pack/levels.json'],
)

export const starterAudioUrl = (line: StarterPackLine): string => {
  const url = audioUrls[`../../../starter/pack/${line.audio}`]
  if (url === undefined) {
    throw new Error(`The starter pack has no file ${line.audio}.`)
  }
  return url
}

// Who made a line's recording and under what terms, in a sentence, as
// its practice screen's footer says it.
export const creditSentence = (credit: StarterCredit): string =>
  credit.source === 'VOICEVOX'
    ? `Voice: ${credit.author}, made with VOICEVOX, under its terms of use.`
    : `Spoken by ${credit.author}, from ${credit.source}, under ${credit.licence}. ${credit.changes}`

export const isUnreviewed = (line: Pick<StarterPackLine, 'review'>): boolean =>
  line.review.verdict === 'unreviewed'

export const unreviewedNote = 'Not yet checked by a native speaker.'

// Whether a native speaker has heard the line yet (ticket 25).
export const reviewNoteOf = (line: Pick<StarterPackLine, 'review'>): string =>
  line.review.verdict === 'unreviewed'
    ? unreviewedNote
    : `Checked by a native speaker on ${line.review.reviewedOn}.`
