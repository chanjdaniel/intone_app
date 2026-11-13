import { Option } from 'effect'

import { lineMarks } from '../../engine/cut/quality'
import type { LevelLine } from './level'

// What a line's marks say (../../engine/cut/quality.ts): in the list, a
// short reason; in the editor, the reason and what it means for a take's
// match, since a line copied from a poor native curve is scored against
// that curve.

export type LineMark = Readonly<{
  name: string
  // Why, in the line's own numbers.
  why: string
  // What it means for the match.
  meaning: string
}>

const percent = (share: number): string => `${Math.round(share * 100)}%`

export const marksOf = (line: LevelLine): ReadonlyArray<LineMark> =>
  Option.match(line.maybeQuality, {
    onNone: () => [],
    onSome: quality => {
      const marks = lineMarks(quality)
      return [
        ...(marks.lowConfidence
          ? [
              {
                name: 'Low pitch confidence',
                why: `A clear pitch was found in only ${percent(quality.confidentShare)} of its speech.`,
                meaning:
                  'Its curve has gaps where the pitch was unclear, so a take is compared on fewer moments and its match says less. A cleaner recording of the line, or a line cut where the voice is clear, will score more fairly.',
              },
            ]
          : []),
        ...(marks.likelyMusic
          ? [
              {
                name: 'Likely music under it',
                why: `A pitch runs through ${percent(quality.pausePitchedShare)} of its pauses, where no one speaks.`,
                meaning:
                  'Music or another sound under the line can be drawn as its pitch, so its curve, and the match of a take against it, may follow that sound rather than the voice. Nothing here can take the music out.',
              },
            ]
          : []),
      ]
    },
  })
