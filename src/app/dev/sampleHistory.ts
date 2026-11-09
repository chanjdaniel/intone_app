import { Schema } from 'effect'

import { TakeEntry } from '../../services/history-records'
import { summarise, trendOf } from '../history/history'

// A learner's history for the library, never typed in: take entries
// dealt from a seed across lines and days, each read by the history's
// own Schema (src/services/history-records.ts), then summed by the
// history screen's own `summarise`. Its counts: 2,000 takes of 200 lines
// over 300 days.

export const sampleCounts = { takes: 2000, lines: 200, days: 300 } as const

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

const words = ['雨', '風', '空', '花', '山', '川', '海', '星'] as const
const ends = ['が好き', 'が降る', 'が青い', 'が咲く', 'を見る'] as const

const decodeEntry = Schema.decodeUnknownSync(TakeEntry)

// The last day dealt: 9 November 2026.
const lastDay = Date.UTC(2026, 10, 9, 9)

export const sampleEntries: ReadonlyArray<TakeEntry> = (() => {
  const next = random(2026)
  const firstDay = lastDay - (sampleCounts.days - 1) * 86_400_000
  const days = Array.from({ length: sampleCounts.days }, (_, d) => d)
    .filter(d => d === sampleCounts.days - 1 || next() < 0.5)
    .map(d => firstDay + d * 86_400_000)
  return Array.from({ length: sampleCounts.takes }, (_, k) => {
    const line = Math.floor(next() * sampleCounts.lines)
    const takenAt =
      (days[Math.floor((k / sampleCounts.takes) * days.length)] ?? firstDay) +
      Math.floor(next() * 36_000_000)
    // A line copied better the more it is practised, with now and then a
    // take that could not be compared.
    const match = Math.min(
      1,
      0.3 + 0.6 * (k / sampleCounts.takes) + 0.2 * next(),
    )
    return decodeEntry({
      format: 1,
      id: `sample-${k}`,
      clipId: `sample-${Math.floor(line / 20) + 1}`,
      lineId: String((line % 20) + 1),
      lineText: `${words[line % words.length] ?? ''}${ends[Math.floor(line / words.length) % ends.length] ?? ''} ${line + 1}`,
      mode: 'Guided',
      takenAt,
      day: new Date(takenAt).toISOString().slice(0, 10),
      nativeId: `native-${line % 8}`,
      score:
        next() < 0.06
          ? { _tag: 'CouldNotCompare', version: 1, reason: 'TooLittleVoiced' }
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
})()

export const sampleSummary = summarise(sampleEntries)

// One line's trend: the line practised most.
export const sampleTrend = (() => {
  const busiest = sampleSummary.lines.reduce((most, line) =>
    line.takes > most.takes ? line : most,
  )
  return trendOf(
    sampleEntries
      .filter(
        entry =>
          entry.clipId === busiest.clipId && entry.lineId === busiest.lineId,
      )
      .slice()
      .sort((a, b) => a.takenAt - b.takenAt),
  )
})()
