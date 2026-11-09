import { Option, Schema } from 'effect'

import { TakeEntry } from '../../services/history-records'
import { LineAsKept, lineProgressOf } from '../history/history'
import type { LineStars } from '../level/level'
import { cutStudyEntry } from './sampleClips'

// A level's stars for the library, never typed in: takes of the cut
// study's clip (./sampleClips.ts) dealt from a seed, guided and blind,
// each read by the history's own Schema, then made into stars by the
// app's own `lineProgressOf`, as the level screen makes them. Its
// counts: up to 6 takes of each line that has a curve, a quarter of them
// blind, one in twenty not compared.

export const sampleStarCounts = {
  mostTakesPerLine: 6,
  blindShare: 1 / 4,
  notComparedShare: 1 / 20,
} as const

// mulberry32.
const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const decodeEntry = Schema.decodeUnknownSync(TakeEntry)

// 9 November 2026, 9:00 UTC.
const firstTake = Date.UTC(2026, 10, 9, 9)

export const sampleStarEntries: ReadonlyArray<TakeEntry> = (() => {
  const next = random(5)
  return cutStudyEntry.lines.flatMap((line, k) => {
    if (line.native._tag !== 'Tracked') {
      return []
    }
    const nativeId = line.native.nativeId
    const takes = Math.floor(next() * (sampleStarCounts.mostTakesPerLine + 1))
    return Array.from({ length: takes }, (_, t) => {
      const takenAt = firstTake + (k * 10 + t) * 60_000
      const mode = next() < sampleStarCounts.blindShare ? 'Blind' : 'Guided'
      // Each take of a line a little closer than the one before.
      const match = Math.min(1, 0.35 + 0.06 * t + 0.35 * next())
      return decodeEntry({
        format: 1,
        id: `stars-${line.id}-${t}`,
        clipId: cutStudyEntry.id,
        lineId: line.id,
        lineText: `${cutStudyEntry.name}, line ${k + 1}`,
        mode,
        takenAt,
        day: new Date(takenAt).toISOString().slice(0, 10),
        nativeId,
        score:
          next() < sampleStarCounts.notComparedShare
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
              },
        audio: null,
      })
    })
  })
})()

export const sampleLevelStars: ReadonlyArray<LineStars> =
  cutStudyEntry.lines.map(line => ({
    lineId: line.id,
    progress: lineProgressOf(
      sampleStarEntries,
      cutStudyEntry.id,
      line.id,
      LineAsKept.Current({
        maybeNativeId:
          line.native._tag === 'Tracked'
            ? Option.some(line.native.nativeId)
            : Option.none(),
      }),
    ),
  }))
