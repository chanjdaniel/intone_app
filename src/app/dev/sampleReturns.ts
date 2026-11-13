import { Array, Option, Order, Schema } from 'effect'

import { random } from '../../score/random'
import { returnOf } from '../../score/returns'
import { starThresholds } from '../../score/stars'
import { TakeEntry } from '../../services/history-records'
import {
  type BlindPoint,
  LineAsKept,
  blindTrendOf,
  lineTakesOf,
} from '../history/history'
import { sourceOfClip } from '../level/commands'
import { dueLinesOf } from '../returns/returns'
import { cutStudyEntry } from './sampleClips'

// Lines that come back, for the library, never typed in: a learner dealt
// from a seed who takes each line of the cut study's clip
// (./sampleClips.ts) blind, then comes back on the day the app's own
// schedule (../../score/returns.ts) says, or a few days after, now and
// then a week late, a little closer each time; every take read by the
// history's own Schema, the lines due worked out by the home screen's
// own `dueLinesOf` on the sample's today.

export const sampleReturnCounts = {
  lines: 30,
  mostReturns: 7,
  // How often the learner comes back late, and by how much at most.
  lateShare: 1 / 4,
  mostDaysLate: 7,
  notComparedShare: 1 / 20,
} as const

// 20 December 2026, the sample's today.
export const sampleToday = '2026-12-20'

const decodeEntry = Schema.decodeUnknownSync(TakeEntry)

const dayMs = 86_400_000
// 9 November 2026, 9:00 UTC.
const firstDay = Date.UTC(2026, 10, 9, 9)

const dayOf = (takenAt: number): string =>
  new Date(takenAt).toISOString().slice(0, 10)

const scoreOf = (match: number | null) =>
  match === null
    ? { _tag: 'CouldNotCompare', version: 1, reason: 'LengthMismatch' }
    : {
        _tag: 'Scored',
        version: 1,
        match,
        parts: { pitchAccent: match, timing: match },
        worstStretch: {
          nativeFrom: 0,
          nativeTo: 0.4,
          takeFrom: 0,
          takeTo: 0.4,
        },
        provisional: true,
      }

const trackedLines = cutStudyEntry.lines
  .filter(line => line.native._tag === 'Tracked')
  .slice(0, sampleReturnCounts.lines)

const sampleReturnEntries: ReadonlyArray<TakeEntry> = (() => {
  const next = random(19)
  return trackedLines.flatMap((line, k) => {
    const nativeId = line.native._tag === 'Tracked' ? line.native.nativeId : ''
    const returns = 1 + Math.floor(next() * sampleReturnCounts.mostReturns)
    const skill = 0.45 + 0.25 * next()
    return Array.makeBy(returns, t => t).reduce<ReadonlyArray<TakeEntry>>(
      (takes, t) => {
        const due = returnOf(takes, starThresholds())
        const late =
          next() < sampleReturnCounts.lateShare
            ? Math.ceil(next() * sampleReturnCounts.mostDaysLate)
            : 0
        const takenAt =
          due === null
            ? firstDay + (k % 10) * dayMs + k * 60_000
            : Date.parse(`${due.dueOn}T09:00:00Z`) + late * dayMs + k * 60_000
        if (dayOf(takenAt) > sampleToday) {
          return takes
        }
        const match =
          next() < sampleReturnCounts.notComparedShare
            ? null
            : Math.min(1, skill + 0.05 * t + 0.2 * next())
        return [
          ...takes,
          decodeEntry({
            format: 1,
            id: `returns-${line.id}-${t}`,
            clipId: cutStudyEntry.id,
            lineId: line.id,
            lineText: `${cutStudyEntry.name}, line ${k + 1}`,
            mode: 'Blind',
            takenAt,
            day: dayOf(takenAt),
            nativeId,
            score: scoreOf(match),
            audio: null,
          }),
        ]
      },
      [],
    )
  })
})()

export const sampleDue = dueLinesOf(
  sampleReturnEntries,
  [{ clipId: cutStudyEntry.id, source: sourceOfClip(cutStudyEntry) }],
  sampleToday,
)

// Each sample line's blind takes, for its chart, the most first.
export const sampleBlindTrends: ReadonlyArray<ReadonlyArray<BlindPoint>> =
  Array.sort(
    trackedLines.map(line =>
      Option.match(
        lineTakesOf(
          sampleReturnEntries,
          cutStudyEntry.id,
          line.id,
          LineAsKept.Current({
            maybeNativeId:
              line.native._tag === 'Tracked'
                ? Option.some(line.native.nativeId)
                : Option.none(),
          }),
        ),
        { onNone: () => [], onSome: ({ takes }) => blindTrendOf(takes) },
      ),
    ),
    Order.flip(
      Order.mapInput(
        Order.Number,
        (points: ReadonlyArray<BlindPoint>) => points.length,
      ),
    ),
  )
