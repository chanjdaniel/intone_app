import { Effect, Option } from 'effect'
import { IDBFactory } from 'fake-indexeddb'

import { describe, expect, it } from '@effect/vitest'

import { syntheticTake } from '../../score/synthetic-take'
import { decodeBackup, encodeBackup } from '../../services/backup'
import { HistoryStore, type NewTake } from '../../services/history-store'
import { LineAsKept, lineReturnOf } from '../history/history'
import type { LevelSource } from '../level/commands'
import { dueLinesOf } from './returns'

// The backup round trip of ticket 12, with returns: a line's next return
// is worked out from its kept blind takes, never stored apart, so a
// backup carries it with them, and a restore on another device brings
// back the same lines due and the same next dates.

const native = syntheticTake({
  pattern: [false, true, false],
  moraFrames: 8,
  registerHz: 230,
  spanSemitones: 6,
  seed: 11,
})

const dayMs = 86_400_000
const nov9 = Date.UTC(2026, 10, 9, 10)

const blindTake = (lineId: string, days: number, match: number): NewTake => ({
  clipId: 'starter',
  lineId,
  lineText: `Line ${lineId}`,
  mode: 'Blind',
  takenAt: nov9 + days * dayMs,
  day: new Date(nov9 + days * dayMs).toISOString().slice(0, 10),
  native,
  take: syntheticTake({
    pattern: [false, true, false],
    moraFrames: 9,
    registerHz: 150,
    spanSemitones: 5,
    seed: days + 1,
  }),
  comparison: {
    score: {
      _tag: 'Scored',
      version: 1,
      match,
      parts: { pitchAccent: match, timing: match },
      worstStretch: {
        nativeFrom: 0.1,
        nativeTo: 0.5,
        takeFrom: 0.1,
        takeTo: 0.5,
      },
      provisional: true,
    },
    alignedTakeF0: Float32Array.from(native.curve.f0Hz),
  },
  audio: Option.none(),
})

const lineIds = ['1', '2', '3'] as const

const sources = [
  {
    clipId: 'starter',
    source: {
      name: 'Starter',
      lines: lineIds.map(lineId => ({
        lineId,
        title: `Line ${lineId}`,
        titleIsText: false,
        copyable: true,
        asKept: LineAsKept.Bundled(),
      })),
    } satisfies LevelSource,
  },
]

const storeOn = () => {
  const layer = HistoryStore.layerTest(
    new IDBFactory(),
    new Map<string, Uint8Array>(),
  )
  return <A, E>(use: (store: HistoryStore['Service']) => Effect.Effect<A, E>) =>
    HistoryStore.use(use).pipe(Effect.provide(layer))
}

const today = '2026-11-20'

describe('the backup, with returns', () => {
  it.effect(
    'brings back the same lines due and the same next dates on another device',
    () =>
      Effect.gen(function* () {
        const from = storeOn()
        const takes = [
          blindTake('1', 0, 0.8),
          blindTake('1', 1, 0.82),
          blindTake('1', 4, 0.86),
          blindTake('2', 2, 0.5),
          blindTake('3', 10, 0.9),
          blindTake('3', 11, 0.92),
        ]
        yield* Effect.forEach(takes, take => from(store => store.keep(take)), {
          discard: true,
        })
        const backup = encodeBackup(yield* from(store => store.dump(false)), 0)

        const to = storeOn()
        const dump = yield* decodeBackup(backup)
        yield* to(store => store.restore(dump))

        const before = (yield* from(store => store.entries)).entries
        const after = (yield* to(store => store.entries)).entries
        const due = dueLinesOf(before, sources, today)
        expect(
          due.due.map(line => [line.lineId, line.lineReturn.dueOn]),
        ).toEqual([
          ['2', '2026-11-12'],
          ['1', '2026-11-20'],
        ])
        expect(due.maybeNextOn).toStrictEqual(Option.some('2026-11-23'))
        expect(dueLinesOf(after, sources, today)).toStrictEqual(due)

        const nextDates = (entries: typeof before) =>
          lineIds.map(lineId =>
            lineReturnOf(entries, 'starter', lineId, LineAsKept.Bundled()),
          )
        expect(nextDates(before).map(Option.map(found => found.dueOn))).toEqual(
          [
            Option.some('2026-11-20'),
            Option.some('2026-11-12'),
            Option.some('2026-11-23'),
          ],
        )
        expect(nextDates(after)).toStrictEqual(nextDates(before))
      }),
  )
})
