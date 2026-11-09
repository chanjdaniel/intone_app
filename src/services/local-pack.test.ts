import { Effect, Layer, Option, Stream } from 'effect'
import { IDBFactory } from 'fake-indexeddb'

import { describe, expect, it } from '@effect/vitest'

import examplePack from '../../fixtures/local-pack/pack.json?raw'
import type { Recording } from '../score/score'
import { syntheticTake } from '../score/synthetic-take'
import { decodeBackup, encodeBackup } from './backup'
import { ClipAnalyser, type ClipEditing } from './clip-analyser'
import { HistoryStore, type NewTake } from './history-store'
import {
  type ChosenFile,
  type PackEvent,
  PackImportError,
  findManifest,
  importPack,
  packClipId,
  readManifest,
  resolveFiles,
} from './local-pack'

const quality = {
  speechFrames: 40,
  confidentShare: 0.7,
  pauseFrames: 12,
  pausePitchedShare: 0,
}

const curveOf = (seed: number): Recording =>
  syntheticTake({
    pattern: [false, true, true, false],
    moraFrames: 9,
    registerHz: 180 + seed,
    spanSemitones: 6,
    seed,
  })

const manifestOf = (value: unknown): ChosenFile => ({
  path: 'pack.json',
  file: new File([JSON.stringify(value)], 'pack.json', {
    type: 'application/json',
  }),
})

const audioFile = (path: string, content: string): ChosenFile => ({
  path,
  file: new File([content], path.slice(path.lastIndexOf('/') + 1), {
    type: 'audio/wav',
  }),
})

const firstManifest = {
  version: 1,
  id: 'sample',
  name: 'Sample pack',
  lines: [
    {
      file: 'audio/hashi.wav',
      text: '橋を渡ります',
      kana: 'はしをわたります',
      source: {
        url: 'https://www.youtube.com/watch?v=planted',
        start: 63,
        end: 66.5,
      },
    },
    { file: 'audio/long.wav', start: 0.5, end: 3, text: '最初の行' },
    { file: 'audio/long.wav', start: 3.5, end: 6 },
  ],
}

// A test of the import: the history in fake IndexedDB and memory, and a
// clip analyser whose tracker gives each span a curve made from its
// times, and counts the files it opens.
const harness = () => {
  const factory = new IDBFactory()
  const files = new Map<string, Uint8Array>()
  const lengths = new Map<Blob, number>()
  const opened: Array<string> = []
  const editing = (file: Blob): ClipEditing => {
    opened.push(file instanceof File ? file.name : 'blob')
    const seconds = lengths.get(file) ?? 8
    return {
      seconds,
      peaks: new Uint8Array(0),
      track: spans =>
        Effect.succeed(
          spans.map(span => ({
            from: span.from,
            to: span.to,
            native: {
              _tag: 'Tracked' as const,
              recording: curveOf(Math.round(span.from * 10 + span.to)),
              quality,
            },
          })),
        ),
    }
  }
  const layer = Layer.merge(
    HistoryStore.layerTest(factory, files),
    ClipAnalyser.layerTest(() => [], editing),
  )
  const chosen = (path: string, content: string, seconds: number) => {
    const made = audioFile(path, content)
    lengths.set(made.file, seconds)
    return made
  }
  const importing = (selection: ReadonlyArray<ChosenFile>) =>
    Stream.runCollect(importPack(selection)).pipe(Effect.provide(layer))
  const history = <A, E>(
    use: (store: HistoryStore['Service']) => Effect.Effect<A, E>,
  ) => HistoryStore.use(use).pipe(Effect.provide(layer))
  return { files, opened, chosen, importing, history }
}

const lastOf = (events: ReadonlyArray<PackEvent>) => events.at(-1)

const reasonOf = (exit: unknown): string =>
  exit instanceof PackImportError ? exit.reason : String(exit)

describe('the manifest', () => {
  it('reads the example pack the tests import', () => {
    const read = readManifest(examplePack)
    expect(read).not.toBeInstanceOf(PackImportError)
    expect(read).toMatchObject({ id: 'example', name: 'Example local pack' })
  })

  it('reads a manifest with every field, and one with only files', () => {
    expect(readManifest(JSON.stringify(firstManifest))).toEqual(firstManifest)
    expect(
      readManifest(
        JSON.stringify({
          version: 1,
          id: 'a',
          name: 'A',
          lines: [{ file: 'a.wav' }],
        }),
      ),
    ).toEqual({ version: 1, id: 'a', name: 'A', lines: [{ file: 'a.wav' }] })
  })

  it.each([
    ['not JSON', '{ version: 1', 'pack.json is not JSON'],
    [
      'a later version',
      JSON.stringify({ ...firstManifest, version: 2 }),
      'Expected 1 at ["version"]',
    ],
    [
      'a path out of its folder',
      JSON.stringify({ ...firstManifest, lines: [{ file: '../x.wav' }] }),
      'with no .. in it at ["lines"][0]["file"]',
    ],
    [
      'an absolute path',
      JSON.stringify({ ...firstManifest, lines: [{ file: '/x.wav' }] }),
      'at ["lines"][0]["file"]',
    ],
    [
      'an id with capitals',
      JSON.stringify({ ...firstManifest, id: 'JSUT' }),
      'lower-case letters, digits and dashes',
    ],
    [
      'no lines',
      JSON.stringify({ ...firstManifest, lines: [] }),
      'at least one line',
    ],
    [
      'a link that is not a web address',
      JSON.stringify({
        ...firstManifest,
        lines: [{ file: 'a.wav', source: { url: 'javascript:alert(1)' } }],
      }),
      'a web address starting https://',
    ],
    [
      'a line that ends before it starts',
      JSON.stringify({
        ...firstManifest,
        lines: [{ file: 'a.wav', start: 2, end: 1 }],
      }),
      'line 1 ends before it starts',
    ],
    [
      'a line over 20 s',
      JSON.stringify({
        ...firstManifest,
        lines: [{ file: 'a.wav' }, { file: 'a.wav', start: 0, end: 25 }],
      }),
      'line 2 is over 20 s long',
    ],
  ])('refuses %s, saying why', (_, text, said) => {
    const read = readManifest(text)
    expect(read).toBeInstanceOf(PackImportError)
    expect(reasonOf(read)).toContain(said)
  })
})

describe('finding the files', () => {
  const manifest = readManifest(JSON.stringify(firstManifest))
  if (manifest instanceof PackImportError) {
    throw manifest
  }

  it('finds the pack.json nearest the top of a folder', () => {
    expect(
      findManifest([
        audioFile('pack/old/pack.json', '{}'),
        audioFile('pack/pack.json', '{}'),
        audioFile('pack/audio/a.wav', 'a'),
      ]),
    ).toMatchObject({ path: 'pack/pack.json' })
  })

  it('says when there is no pack.json, or two', () => {
    expect(reasonOf(findManifest([audioFile('a.wav', 'a')]))).toContain(
      'There is no pack.json in what you chose',
    )
    expect(
      reasonOf(
        findManifest([
          audioFile('a/pack.json', ''),
          audioFile('b/pack.json', ''),
        ]),
      ),
    ).toContain('holds 2 files named pack.json')
  })

  it('finds each file by its path in the folder, or by its name when chosen one by one', () => {
    const inFolder = resolveFiles(manifest, 'pack/pack.json', [
      audioFile('pack/pack.json', ''),
      audioFile('pack/audio/hashi.wav', 'h'),
      audioFile('pack/audio/long.wav', 'l'),
      audioFile('pack/other/long.wav', 'x'),
    ])
    expect(
      inFolder instanceof PackImportError
        ? inFolder
        : [...inFolder].map(([path, file]) => [path, file.path]),
    ).toEqual([
      ['audio/hashi.wav', 'pack/audio/hashi.wav'],
      ['audio/long.wav', 'pack/audio/long.wav'],
    ])
    const oneByOne = resolveFiles(manifest, 'pack.json', [
      audioFile('pack.json', ''),
      audioFile('hashi.wav', 'h'),
      audioFile('long.wav', 'l'),
    ])
    expect(
      oneByOne instanceof PackImportError
        ? oneByOne
        : [...oneByOne].map(([path, file]) => [path, file.path]),
    ).toEqual([
      ['audio/hashi.wav', 'hashi.wav'],
      ['audio/long.wav', 'long.wav'],
    ])
  })

  it('names each file the manifest names and the selection lacks', () => {
    expect(
      reasonOf(
        resolveFiles(manifest, 'pack.json', [
          audioFile('pack.json', ''),
          audioFile('long.wav', 'l'),
        ]),
      ),
    ).toBe(
      'pack.json names a file you did not choose: audio/hashi.wav. Choose it too, or the folder that holds the pack.',
    )
  })

  it('asks for the folder when two files of the pack share a name and were chosen one by one', () => {
    const shared = readManifest(
      JSON.stringify({
        ...firstManifest,
        lines: [{ file: 'a/line.wav' }, { file: 'b/line.wav' }],
      }),
    )
    if (shared instanceof PackImportError) {
      throw shared
    }
    expect(
      reasonOf(
        resolveFiles(shared, 'pack.json', [
          audioFile('pack.json', ''),
          audioFile('line.wav', '1'),
        ]),
      ),
    ).toContain('Choose the folder that holds the pack')
  })
})

describe('importing a pack', () => {
  it.effect(
    'keeps the pack as one level: its files, its lines with their text, kana and source, and their curves',
    () =>
      Effect.gen(function* () {
        const { importing, history, files, opened, chosen } = harness()
        const events = yield* importing([
          manifestOf(firstManifest),
          chosen('hashi.wav', 'hashi', 1.8),
          chosen('long.wav', 'long-v1', 8),
        ])
        expect(events.map(event => event._tag)).toEqual([
          'Reading',
          'CheckingFiles',
          'CheckingFiles',
          'CheckingFiles',
          'TrackingLines',
          'TrackingLines',
          'TrackingLines',
          'Keeping',
          'Imported',
        ])
        expect(lastOf(events)).toEqual({
          _tag: 'Imported',
          clipId: 'pack-sample',
          kept: 0,
          added: 3,
          removed: 0,
        })
        expect(opened).toEqual(['hashi.wav', 'long.wav'])
        const clip = Option.getOrThrow(
          yield* history(store => store.clip(packClipId('sample'))),
        )
        expect(clip.name).toBe('Sample pack')
        expect(clip.audio).toBeNull()
        expect(clip.seconds).toBeCloseTo(9.8)
        expect(clip.nextLineId).toBe(4)
        expect(
          clip.lines.map(({ id, file, from, to, text, kana, source }) => ({
            id,
            file,
            from,
            to,
            text,
            kana,
            source,
          })),
        ).toEqual([
          {
            id: '1',
            file: 'audio/hashi.wav',
            from: 0,
            to: 1.8,
            text: '橋を渡ります',
            kana: 'はしをわたります',
            source: {
              url: 'https://www.youtube.com/watch?v=planted',
              from: 63,
              to: 66.5,
            },
          },
          {
            id: '2',
            file: 'audio/long.wav',
            from: 0.5,
            to: 3,
            text: '最初の行',
            kana: undefined,
            source: undefined,
          },
          {
            id: '3',
            file: 'audio/long.wav',
            from: 3.5,
            to: 6,
            text: undefined,
            kana: undefined,
            source: undefined,
          },
        ])
        expect(clip.lines.every(line => line.native._tag === 'Tracked')).toBe(
          true,
        )
        expect([...files.keys()].sort()).toEqual(
          (clip.pack?.files ?? []).map(file => file.audio?.file).sort(),
        )
        expect(
          new TextDecoder().decode(
            files.get(clip.pack?.files[1]?.audio?.file ?? ''),
          ),
        ).toBe('long-v1')
        const line = Option.getOrThrow(
          yield* history(store => store.clipLine('pack-sample', '2')),
        )
        expect(Option.isSome(line.maybeNative)).toBe(true)
      }),
  )

  it.effect(
    'imported again with a changed manifest, keeps each line whose file and span are unchanged, with its takes',
    () =>
      Effect.gen(function* () {
        const { importing, history, files, opened, chosen } = harness()
        yield* importing([
          manifestOf(firstManifest),
          chosen('hashi.wav', 'hashi', 1.8),
          chosen('long.wav', 'long-v1', 8),
        ])
        const before = Option.getOrThrow(
          yield* history(store => store.clip('pack-sample')),
        )
        const nativeOf = (lineId: string) =>
          history(store => store.clipLine('pack-sample', lineId)).pipe(
            Effect.map(found =>
              Option.getOrThrow(
                Option.flatMap(found, ({ maybeNative }) => maybeNative),
              ),
            ),
          )
        const takeOf = (lineId: string, native: Recording): NewTake => ({
          clipId: 'pack-sample',
          lineId,
          lineText: `Line ${lineId}`,
          mode: 'Guided',
          takenAt: Date.UTC(2026, 10, 10, 10),
          day: '2026-11-10',
          native,
          take: curveOf(40),
          comparison: {
            score: {
              _tag: 'CouldNotCompare',
              version: 1,
              reason: 'TooLittleVoiced',
            },
            alignedTakeF0: null,
          },
          audio: Option.none(),
        })
        const native1 = yield* nativeOf('1')
        const native3 = yield* nativeOf('3')
        yield* history(store => store.keep(takeOf('1', native1)))
        yield* history(store => store.keep(takeOf('3', native3)))
        opened.length = 0

        const changed = {
          ...firstManifest,
          name: 'Sample pack, fixed',
          lines: [
            { ...firstManifest.lines[0], text: '橋を渡ります。' },
            { file: 'audio/long.wav', start: 3.6, end: 6 },
            { file: 'audio/new.wav', text: '新しい行' },
          ],
        }
        const events = yield* importing([
          manifestOf(changed),
          chosen('hashi.wav', 'hashi', 1.8),
          chosen('long.wav', 'long-v1', 8),
          chosen('new.wav', 'new', 2.2),
        ])
        expect(lastOf(events)).toEqual({
          _tag: 'Imported',
          clipId: 'pack-sample',
          kept: 1,
          added: 2,
          removed: 2,
        })
        expect(opened).toEqual(['long.wav', 'new.wav'])
        const after = Option.getOrThrow(
          yield* history(store => store.clip('pack-sample')),
        )
        expect(after.name).toBe('Sample pack, fixed')
        expect(after.addedAt).toBe(before.addedAt)
        expect(
          after.lines.map(line => [line.id, line.file, line.from, line.to]),
        ).toEqual([
          ['1', 'audio/hashi.wav', 0, 1.8],
          ['4', 'audio/long.wav', 3.6, 6],
          ['5', 'audio/new.wav', 0, 2.2],
        ])
        expect(after.lines[0]?.text).toBe('橋を渡ります。')
        expect(after.lines[0]?.native).toEqual(before.lines[0]?.native)
        const { entries } = yield* history(store => store.entries)
        expect(entries.map(entry => [entry.lineId, entry.nativeId])).toEqual(
          expect.arrayContaining([
            [
              '1',
              after.lines[0]?.native._tag === 'Tracked'
                ? after.lines[0].native.nativeId
                : '',
            ],
            [
              '3',
              before.lines[2]?.native._tag === 'Tracked'
                ? before.lines[2].native.nativeId
                : '',
            ],
          ]),
        )
        // The take of line 1 is still against a curve the device keeps.
        const take1 = entries.find(entry => entry.lineId === '1')
        expect(
          Option.isSome(
            yield* history(store => store.fullTake(take1?.id ?? '')),
          ),
        ).toBe(true)
        expect([...files.keys()].sort()).toEqual(
          (after.pack?.files ?? []).map(file => file.audio?.file).sort(),
        )
      }),
  )

  it.effect(
    'imported again unchanged, tracks nothing and keeps every line',
    () =>
      Effect.gen(function* () {
        const { importing, opened, chosen } = harness()
        const selection = [
          manifestOf(firstManifest),
          chosen('hashi.wav', 'hashi', 1.8),
          chosen('long.wav', 'long-v1', 8),
        ]
        yield* importing(selection)
        opened.length = 0
        const events = yield* importing(selection)
        expect(opened).toEqual([])
        expect(lastOf(events)).toMatchObject({ kept: 3, added: 0, removed: 0 })
      }),
  )

  it.effect(
    'a file changed under the same name makes its lines new, and its old copy goes',
    () =>
      Effect.gen(function* () {
        const { importing, history, files, chosen } = harness()
        yield* importing([
          manifestOf(firstManifest),
          chosen('hashi.wav', 'hashi', 1.8),
          chosen('long.wav', 'long-v1', 8),
        ])
        const before = Option.getOrThrow(
          yield* history(store => store.clip('pack-sample')),
        )
        const events = yield* importing([
          manifestOf(firstManifest),
          chosen('hashi.wav', 'hashi', 1.8),
          chosen('long.wav', 'long-v2', 8),
        ])
        expect(lastOf(events)).toMatchObject({ kept: 1, added: 2, removed: 2 })
        const after = Option.getOrThrow(
          yield* history(store => store.clip('pack-sample')),
        )
        expect(after.lines.map(line => line.id)).toEqual(['1', '4', '5'])
        expect(files.has(before.pack?.files[1]?.audio?.file ?? '')).toBe(false)
        expect(
          new TextDecoder().decode(
            files.get(after.pack?.files[1]?.audio?.file ?? ''),
          ),
        ).toBe('long-v2')
      }),
  )

  it.effect(
    'refuses a selection that lacks a file the manifest names, keeping nothing',
    () =>
      Effect.gen(function* () {
        const { importing, history, files, opened, chosen } = harness()
        const failure = yield* importing([
          manifestOf(firstManifest),
          chosen('long.wav', 'long-v1', 8),
        ]).pipe(Effect.flip)
        expect(failure.reason).toContain(
          'pack.json names a file you did not choose: audio/hashi.wav',
        )
        expect(opened).toEqual([])
        expect(files.size).toBe(0)
        expect(
          Option.isNone(yield* history(store => store.clip('pack-sample'))),
        ).toBe(true)
      }),
  )

  it.effect('refuses a line that runs past the end of its file', () =>
    Effect.gen(function* () {
      const { importing, history, files, chosen } = harness()
      const failure = yield* importing([
        manifestOf(firstManifest),
        chosen('hashi.wav', 'hashi', 1.8),
        chosen('long.wav', 'long-v1', 5),
      ]).pipe(Effect.flip)
      expect(failure.reason).toBe(
        'A line of audio/long.wav runs from 3.5 s to 6.00 s, and the file is 5.00 s long.',
      )
      expect(files.size).toBe(0)
      expect(
        Option.isNone(yield* history(store => store.clip('pack-sample'))),
      ).toBe(true)
    }),
  )

  it.effect('refuses a whole file over 20 s given as one line', () =>
    Effect.gen(function* () {
      const { importing, chosen } = harness()
      const failure = yield* importing([
        manifestOf({ ...firstManifest, lines: [{ file: 'long.wav' }] }),
        chosen('long.wav', 'long-v1', 42),
      ]).pipe(Effect.flip)
      expect(failure.reason).toContain(
        'A line of long.wav is 42.00 s long. A line is a quarter of a second to 20 s long',
      )
    }),
  )

  it.effect(
    'goes into the backup with every file, keeps its audio here when restored without it, and is deleted with every file',
    () =>
      Effect.gen(function* () {
        const { importing, history, files, chosen } = harness()
        yield* importing([
          manifestOf(firstManifest),
          chosen('hashi.wav', 'hashi', 1.8),
          chosen('long.wav', 'long-v1', 8),
        ])
        const pack = Option.getOrThrow(
          yield* history(store => store.clip('pack-sample')),
        )
        const stored = (pack.pack?.files ?? []).map(file => file.audio?.file)

        const withAudio = yield* decodeBackup(
          encodeBackup(yield* history(store => store.dump(true)), 5_000),
        )
        expect(withAudio.clips).toEqual([pack])
        expect([...withAudio.audio.keys()].sort()).toEqual([...stored].sort())

        const without = yield* decodeBackup(
          encodeBackup(yield* history(store => store.dump(false)), 5_000),
        )
        expect(
          without.clips[0]?.pack?.files.every(file => file.audio === null),
        ).toBe(true)
        yield* history(store => store.restore(without))
        expect(
          Option.getOrThrow(yield* history(store => store.clip('pack-sample'))),
        ).toEqual(pack)

        yield* history(store => store.removeClip('pack-sample'))
        expect(files.size).toBe(0)
        expect(
          Option.isNone(yield* history(store => store.clip('pack-sample'))),
        ).toBe(true)
      }),
  )
})
