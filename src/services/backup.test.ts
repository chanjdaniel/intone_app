import { Effect, Option } from 'effect'
import { IDBFactory } from 'fake-indexeddb'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { describe, expect, it } from '@effect/vitest'

import { syntheticTake } from '../score/synthetic-take'
import { decodeBackup, encodeBackup, historyFile } from './backup'
import { HistoryStore, type NewTake } from './history-store'

const native = syntheticTake({
  pattern: [false, true, false],
  moraFrames: 8,
  registerHz: 230,
  spanSemitones: 6,
  seed: 11,
})

const takeOf = (seed: number, takenAt: number): NewTake => ({
  clipId: 'ame-ga-suki',
  lineId: '1',
  lineText: '雨が好き',
  mode: 'Guided',
  takenAt,
  day: '2026-11-09',
  native,
  take: syntheticTake({
    pattern: [false, true, false],
    moraFrames: 9,
    registerHz: 150,
    spanSemitones: 5,
    seed,
  }),
  comparison: {
    score: {
      _tag: 'Scored',
      version: 1,
      match: 0.5 + seed / 100,
      parts: { pitchAccent: 0.6, timing: 0.4, sounds: 0.3 },
      worstStretch: {
        nativeFrom: 0.1,
        nativeTo: 0.5,
        takeFrom: 0.1,
        takeTo: 0.5,
      },
      provisional: true,
    },
    alignedTakeF0: Float32Array.from(native.curve.f0Hz, hz => hz / 3 + 0.1),
  },
  audio: Option.some({
    samples: Float32Array.from({ length: 2400 }, (_, k) => Math.sin(k / 5) / 3),
    sampleRate: 48_000,
  }),
})

const historyWith = (keepAudio: boolean) => {
  const factory = new IDBFactory()
  const files = new Map<string, Uint8Array>()
  const layer = HistoryStore.layerTest(factory, files)
  const run = <A, E>(
    use: (store: HistoryStore['Service']) => Effect.Effect<A, E>,
  ) => HistoryStore.use(use).pipe(Effect.provide(layer))
  return Effect.gen(function* () {
    yield* run(store => store.setSettings({ keepTakeAudio: keepAudio }))
    yield* run(store => store.keep(takeOf(1, 1_000)))
    yield* run(store => store.keep(takeOf(2, 2_000)))
    return { run, files }
  })
}

const zipOf = (files: Record<string, string | Uint8Array>): Uint8Array =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        typeof content === 'string' ? strToU8(content) : content,
      ]),
    ),
  )

const historyJsonOf = (backup: Uint8Array) =>
  JSON.parse(strFromU8(unzipSync(backup)[historyFile] ?? new Uint8Array()))

const refusal = (bytes: Uint8Array) =>
  decodeBackup(bytes).pipe(
    Effect.flip,
    Effect.map(error => error.reason),
  )

describe('the backup', () => {
  it.effect(
    'carries the whole history to another device and back, every value exact',
    () =>
      Effect.gen(function* () {
        const from = yield* historyWith(true)
        const backup = encodeBackup(
          yield* from.run(store => store.dump(true)),
          5_000,
        )
        const to = historyWith(false)
        const restored = yield* to
        const dump = yield* decodeBackup(backup)
        expect(yield* restored.run(store => store.restore(dump))).toBe(2)

        const before = yield* from.run(store => store.entries)
        const after = yield* restored.run(store => store.entries)
        expect(after.entries).toHaveLength(4)
        const ids = before.entries.map(entry => entry.id)
        for (const id of ids) {
          const original = yield* from.run(store => store.fullTake(id))
          const copy = yield* restored.run(store => store.fullTake(id))
          expect(copy).toEqual(original)
        }
        expect(yield* restored.run(store => store.settings)).toEqual({
          keepTakeAudio: true,
        })
        for (const [path, bytes] of from.files) {
          expect(restored.files.get(path)).toEqual(bytes)
        }
      }),
  )

  it.effect('is made whatever the device’s clock says', () =>
    Effect.gen(function* () {
      const from = yield* historyWith(false)
      const dump = yield* from.run(store => store.dump(false))
      const early = yield* decodeBackup(encodeBackup(dump, 5_000))
      expect(early.takes).toHaveLength(2)
      expect(encodeBackup(dump, Date.UTC(2026, 10, 10))).toEqual(
        encodeBackup(dump, Date.UTC(2026, 10, 10)),
      )
    }),
  )

  it.effect('leaves the audio out unless asked to bring it', () =>
    Effect.gen(function* () {
      const from = yield* historyWith(true)
      const backup = encodeBackup(
        yield* from.run(store => store.dump(false)),
        5_000,
      )
      expect(Object.keys(unzipSync(backup))).toEqual([historyFile])
      expect(
        historyJsonOf(backup).takes.map(
          (take: { entry: { audio: unknown } }) => take.entry.audio,
        ),
      ).toEqual([null, null])
      const withAudio = encodeBackup(
        yield* from.run(store => store.dump(true)),
        5_000,
      )
      expect(Object.keys(unzipSync(withAudio)).sort()).toEqual(
        [
          'audio/' + [...from.files.keys()][0]?.split('/')[1],
          'audio/' + [...from.files.keys()][1]?.split('/')[1],
          historyFile,
        ].sort(),
      )
    }),
  )

  it.effect('refuses a file that is not a backup, and says why', () =>
    Effect.gen(function* () {
      const from = yield* historyWith(true)
      const good = encodeBackup(
        yield* from.run(store => store.dump(true)),
        5_000,
      )
      const json = historyJsonOf(good)
      const audioFiles = Object.fromEntries(
        Object.entries(unzipSync(good)).filter(
          ([name]) => name !== historyFile,
        ),
      )

      expect(yield* refusal(strToU8('not a zip'))).toContain('not a zip file')
      expect(yield* refusal(zipOf({ 'notes.txt': 'hello' }))).toContain(
        'has no history.json',
      )
      expect(yield* refusal(zipOf({ [historyFile]: '{ broken' }))).toContain(
        'does not hold a history',
      )
      expect(
        yield* refusal(
          zipOf({ [historyFile]: JSON.stringify({ ...json, app: 'other' }) }),
        ),
      ).toContain('does not hold a history')
      expect(
        yield* refusal(
          zipOf({ [historyFile]: JSON.stringify({ ...json, format: 99 }) }),
        ),
      ).toContain('does not hold a history')
      const cutFrames = structuredClone(json)
      cutFrames.takes[0].recording.take.f0Hz = 'AAAA'.slice(0, 3) + '='
      expect(
        yield* refusal(
          zipOf({ [historyFile]: JSON.stringify(cutFrames), ...audioFiles }),
        ),
      ).toContain('does not hold a history')
      const badScore = structuredClone(json)
      badScore.takes[1].entry.score.match = 1.5
      expect(
        yield* refusal(
          zipOf({ [historyFile]: JSON.stringify(badScore), ...audioFiles }),
        ),
      ).toContain('does not hold a history')
      const escaping = structuredClone(json)
      escaping.takes[0].entry.audio.file = '../outside.wav'
      expect(
        yield* refusal(
          zipOf({ [historyFile]: JSON.stringify(escaping), ...audioFiles }),
        ),
      ).toContain('does not hold a history')
      expect(
        yield* refusal(
          zipOf({
            [historyFile]: JSON.stringify({ ...json, natives: [] }),
            ...audioFiles,
          }),
        ),
      ).toContain('missing the line it was scored against')
      expect(
        yield* refusal(zipOf({ [historyFile]: JSON.stringify(json) })),
      ).toContain('is missing or damaged')
      const damagedAudio = Object.fromEntries(
        Object.keys(audioFiles).map(name => [name, 'not audio']),
      )
      expect(
        yield* refusal(
          zipOf({ [historyFile]: JSON.stringify(json), ...damagedAudio }),
        ),
      ).toContain('is missing or damaged')
    }),
  )

  it.effect('restores nothing from a file it refuses', () =>
    Effect.gen(function* () {
      const to = yield* historyWith(false)
      const before = yield* to.run(store => store.entries)
      const result = yield* decodeBackup(zipOf({ [historyFile]: '[]' })).pipe(
        Effect.flatMap(dump => to.run(store => store.restore(dump))),
        Effect.result,
      )
      expect(result._tag).toBe('Failure')
      expect(yield* to.run(store => store.entries)).toEqual(before)
    }),
  )

  it.effect(
    'carries a clip and its lines, its file only when asked, and refuses a backup missing one',
    () =>
      Effect.gen(function* () {
        const from = yield* historyWith(false)
        const clipBytes = Uint8Array.from({ length: 300 }, (_, k) => k % 251)
        const clip = yield* from.run(store =>
          store.addClip({
            name: 'reading.m4a',
            type: 'audio/mp4',
            addedAt: 3_000,
            seconds: 9,
            bytes: Uint8Array.from(clipBytes),
            lines: [
              {
                from: 0.5,
                to: 2.5,
                native: { _tag: 'Tracked', recording: native },
              },
            ],
          }),
        )
        const clipFile = clip.audio?.file ?? ''

        const without = encodeBackup(
          yield* from.run(store => store.dump(false)),
          5_000,
        )
        expect(Object.keys(unzipSync(without))).toEqual([historyFile])
        expect(historyJsonOf(without).clips[0].audio).toBeNull()
        const restoredWithout = yield* decodeBackup(without)
        expect(restoredWithout.clips).toEqual([{ ...clip, audio: null }])

        const withAudio = encodeBackup(
          yield* from.run(store => store.dump(true)),
          5_000,
        )
        const zipped = unzipSync(withAudio)
        expect(Object.keys(zipped)).toContain(`clips/${clipFile.split('/')[1]}`)
        const restored = yield* decodeBackup(withAudio)
        expect(restored.clips).toEqual([clip])
        expect(restored.audio.get(clipFile)).toEqual(clipBytes)

        const json = historyJsonOf(withAudio)
        expect(
          yield* refusal(zipOf({ [historyFile]: JSON.stringify(json) })),
        ).toBe(
          `This file is not an Intone backup this app can read: the clip ${clipFile} is missing or damaged.`,
        )
        expect(
          yield* refusal(
            zipOf({
              [historyFile]: JSON.stringify({ ...json, natives: [] }),
            }),
          ),
        ).toContain('missing')
      }),
  )

  it.effect('reads a backup made before clips, as having none', () =>
    Effect.gen(function* () {
      const from = yield* historyWith(false)
      const backup = encodeBackup(
        yield* from.run(store => store.dump(false)),
        5_000,
      )
      const { clips: _clips, ...older } = historyJsonOf(backup)
      const dump = yield* decodeBackup(
        zipOf({ [historyFile]: JSON.stringify(older) }),
      )
      expect(dump.clips).toEqual([])
      expect(dump.takes).toHaveLength(2)
    }),
  )
})
