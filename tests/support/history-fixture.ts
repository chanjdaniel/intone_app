import { Schema } from 'effect'

import type { Recording } from '../../src/score/score.ts'
import { syntheticTake } from '../../src/score/synthetic-take.ts'
import { encodeBackup } from '../../src/services/backup.ts'
import { compareTake } from '../../src/services/compare-take.ts'
import {
  type HistoryDump,
  NativeEntry,
  TakeEntry,
  TakeRecording,
  historyFormat,
  recordingId,
  storedRecordingOf,
} from '../../src/services/history-records.ts'
import { random } from './random.ts'

// A long history, for the history screens' test at scale: takes dealt
// from a seed across many lines and many days, each a seeded synthetic
// recording (src/score/synthetic-take.ts) scored by the app's own score,
// every record made through the app's own Schemas and written as the
// app's own backup file (src/services/backup.ts). Nothing is typed in:
// the same seed gives the same file, byte for byte.

export const historyFixture = {
  seed: 12,
  takes: 5000,
  lines: 160,
  // One line practised far more than the rest, as a learner's favourite
  // is: every fourth take, so its page draws a trend of 1,250.
  favouriteEvery: 4,
  natives: 8,
  takesPerNative: 5,
  // The last day dealt, and how many days back the history reaches.
  lastDay: Date.UTC(2026, 10, 9, 9),
  days: 400,
  exportedAt: Date.UTC(2026, 10, 10, 9),
} as const

const words = ['雨', '風', '空', '花', '山', '川', '海', '星'] as const
const ends = ['が好き', 'が降る', 'が青い', 'が咲く', 'を見る'] as const

const patterns: ReadonlyArray<ReadonlyArray<boolean>> = [
  [false, true, true, true],
  [true, false, false, false],
  [false, true, false, false],
  [false, true, true, false],
  [false, true, true, true, true],
  [true, false, false, false, false],
  [false, true, true, false, false],
  [false, true, false, false, false],
]

const decodeEntry = Schema.decodeUnknownSync(TakeEntry)
const decodeRecording = Schema.decodeUnknownSync(TakeRecording)
const decodeNative = Schema.decodeUnknownSync(NativeEntry)

const isoDayOf = (time: number): string =>
  new Date(time).toISOString().slice(0, 10)

export type GeneratedHistory = Readonly<{
  dump: HistoryDump
  // The line with the most takes.
  favourite: Readonly<{ clipId: string; lineId: string; lineText: string }>
  daysPractised: number
}>

export const generateHistory = (): GeneratedHistory => {
  const next = random(historyFixture.seed)
  const pick = (count: number) => Math.floor(next() * count)

  const natives = Array.from({ length: historyFixture.natives }, (_, n) => {
    const pattern = patterns[n % patterns.length] ?? [true, false]
    const native = syntheticTake({
      pattern,
      moraFrames: 9,
      registerHz: 210 + 15 * n,
      spanSemitones: 6,
      seed: 1000 + n,
    })
    // Takes of the line in other voices, some copying it and some not.
    const takes = Array.from(
      { length: historyFixture.takesPerNative },
      (_, t) => {
        const take: Recording = syntheticTake({
          pattern: t % 3 === 2 ? pattern.map(high => !high) : pattern,
          moraFrames: 8 + t,
          registerHz: 110 + 20 * t,
          spanSemitones: 4 + t,
          seed: 2000 + n * 100 + t,
          jitter: 0.1 + 0.1 * t,
        })
        return { take, comparison: compareTake(native, take) }
      },
    )
    return { native, id: recordingId(native), takes }
  })

  const lines = Array.from({ length: historyFixture.lines }, (_, k) => ({
    clipId: `generated-${Math.floor(k / 20) + 1}`,
    lineId: String((k % 20) + 1),
    lineText: `${words[k % words.length] ?? ''}${ends[Math.floor(k / words.length) % ends.length] ?? ''}${k >= 40 ? ` ${k + 1}` : ''}`,
    native: k % historyFixture.natives,
  }))

  // Days practised: runs of practice with breaks between them, the latest
  // on the last day.
  const firstDay =
    historyFixture.lastDay - (historyFixture.days - 1) * 86_400_000
  const practised = Array.from({ length: historyFixture.days }, (_, d) => d)
    .filter(d => d === historyFixture.days - 1 || next() < 0.55)
    .map(d => firstDay + d * 86_400_000)

  const takes = Array.from({ length: historyFixture.takes }, (_, k) => {
    const line =
      k % historyFixture.favouriteEvery === 0
        ? lines[0]
        : lines[1 + pick(historyFixture.lines - 1)]
    if (line === undefined) {
      throw new Error('no line')
    }
    const native = natives[line.native]
    const scored = native?.takes[pick(historyFixture.takesPerNative)]
    if (native === undefined || scored === undefined) {
      throw new Error('no native')
    }
    const day =
      practised[Math.floor((k / historyFixture.takes) * practised.length)] ??
      firstDay
    const takenAt = day + pick(12 * 3_600_000)
    const id = `${takenAt.toString(36)}-${k.toString(16).padStart(8, '0')}`
    return {
      entry: decodeEntry({
        format: historyFormat,
        id,
        clipId: line.clipId,
        lineId: line.lineId,
        lineText: line.lineText,
        mode: 'Guided',
        takenAt,
        day: isoDayOf(takenAt),
        nativeId: native.id,
        score: scored.comparison.score,
        audio: null,
      }),
      recording: decodeRecording({
        format: historyFormat,
        id,
        take: storedRecordingOf(scored.take),
        alignedF0: scored.comparison.alignedTakeF0,
      }),
    }
  })

  const favourite = lines[0]
  if (favourite === undefined) {
    throw new Error('no line')
  }
  return {
    dump: {
      settings: { keepTakeAudio: false },
      natives: natives.map(({ native, id }) =>
        decodeNative({
          format: historyFormat,
          id,
          recording: storedRecordingOf(native),
        }),
      ),
      takes,
      audio: new Map(),
    },
    favourite: {
      clipId: favourite.clipId,
      lineId: favourite.lineId,
      lineText: favourite.lineText,
    },
    daysPractised: new Set(takes.map(({ entry }) => entry.day)).size,
  }
}

// The backup file of the generated history.
export const generatedBackup = (history: GeneratedHistory): Uint8Array =>
  encodeBackup(history.dump, historyFixture.exportedAt)
