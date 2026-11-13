import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  type Model,
  ensureCached,
  modelDirectory,
  modelVersion,
  models,
  readModelList,
} from '../../build/models.ts'
import { productionBuild } from '../support/build'
import { root } from '../support/run'

// The checked model list. These tests fetch SwiftF0 from its pinned URL,
// as the build does, into a cache of their own.

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'models-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const listed = async (): Promise<Model> => {
  const [swiftF0] = (await readModelList(join(root, 'models.json'))).filter(
    model => model.id === 'swift-f0',
  )
  if (swiftF0 === undefined) {
    throw new Error('models.json lists no swift-f0')
  }
  return swiftF0
}

const plantList = (entries: ReadonlyArray<unknown>): string => {
  const path = join(scratch, 'models.json')
  writeFileSync(path, JSON.stringify({ models: entries }))
  return path
}

const cacheFiles = (cache: string): ReadonlyArray<string> =>
  readdirSync(cache, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)

describe('models.json', () => {
  test("lists SwiftF0's ONNX model from its MIT repository at a pinned commit", async () => {
    const swiftF0 = await listed()

    expect(swiftF0).toMatchObject({
      licence: 'MIT',
      files: [
        {
          path: 'model.onnx',
          url: expect.stringMatching(
            /^https:\/\/raw\.githubusercontent\.com\/lars76\/swift-f0\/[0-9a-f]{40}\/swift_f0\/model\.onnx$/,
          ),
        },
      ],
    })
  })

  // The files Transformers.js 4.3.2 loads for a Whisper model at the
  // dtypes the text Worker asks for (`q4` encoder, `int8` merged decoder),
  // seen in the requests of a run in Chromium: docs/transcription.md.
  const whisperFiles = [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_q4.onnx',
    'onnx/decoder_model_merged_int8.onnx',
  ]

  test.each([
    ['whisper-base', 'whisper-base_timestamped'],
    ['whisper-small', 'whisper-small_timestamped'],
  ])(
    'lists every file Transformers.js loads for %s, from %s at one pinned revision, MIT',
    async (id, repository) => {
      const whisper = (await readModelList(join(root, 'models.json'))).find(
        model => model.id === id,
      )
      const revisions = new Set(
        whisper?.files.map(file => file.url.split('/')[6]),
      )

      expect(whisper?.licence).toBe('MIT')
      expect(whisper?.files.map(file => file.path)).toStrictEqual(whisperFiles)
      expect(revisions.size).toBe(1)
      for (const file of whisper?.files ?? []) {
        expect(file.url).toBe(
          `https://huggingface.co/onnx-community/${repository}/resolve/${[...revisions][0]}/${file.path}`,
        )
      }
    },
  )

  test("keeps whisper-small's 149.5 MiB merged decoder, the largest file served", async () => {
    const files = (await readModelList(join(root, 'models.json'))).flatMap(
      model => model.files,
    )
    const largest = files.reduce((a, b) => (b.bytes > a.bytes ? b : a))

    expect(largest).toMatchObject({
      path: 'onnx/decoder_model_merged_int8.onnx',
      bytes: 156_795_750,
      sha256:
        'c831996a6d5a535cf17447b0d7ecc36da6b72696e6fb906852ba6136b9199abb',
    })
  })

  test.each([
    ['no licence', { licence: '' }],
    ['no source page', { source: 'swift-f0' }],
    ['no files', { files: [] }],
  ])('refuses a model with %s', async (_reason, change) => {
    const path = plantList([{ ...(await listed()), ...change }])

    await expect(readModelList(path)).rejects.toThrow()
  })

  test.each([
    [
      'a branch instead of a pinned commit',
      {
        url: 'https://raw.githubusercontent.com/lars76/swift-f0/main/swift_f0/model.onnx',
      },
    ],
    ['a short hash', { sha256: 'abc' }],
    ['a size that is not a whole number of bytes', { bytes: 1.5 }],
    ['a path that climbs out of its directory', { path: '../model.onnx' }],
    ['a path inside that climbs', { path: 'onnx/../../model.onnx' }],
    ['an absolute path', { path: '/model.onnx' }],
    ['a path naming a folder only', { path: 'onnx/' }],
    ['an empty path', { path: '' }],
  ])('refuses a file with %s', async (_reason, change) => {
    const swiftF0 = await listed()
    const path = plantList([
      { ...swiftF0, files: [{ ...swiftF0.files[0], ...change }] },
    ])

    await expect(readModelList(path)).rejects.toThrow()
  })

  test('takes a path that names a folder', async () => {
    const swiftF0 = await listed()
    const path = plantList([
      {
        ...swiftF0,
        files: [
          { ...swiftF0.files[0], path: 'onnx/decoder_model_merged_int8.onnx' },
        ],
      },
    ])

    const [model] = await readModelList(path)
    expect(model?.files[0].path).toBe('onnx/decoder_model_merged_int8.onnx')
  })

  test('refuses an id listed twice', async () => {
    const swiftF0 = await listed()
    const path = plantList([swiftF0, { ...swiftF0, name: 'Again' }])

    await expect(readModelList(path)).rejects.toThrow(
      /every model id is used once/,
    )
  })

  test('refuses a file path listed twice in one model', async () => {
    const swiftF0 = await listed()
    const path = plantList([
      { ...swiftF0, files: [swiftF0.files[0], swiftF0.files[0]] },
    ])

    await expect(readModelList(path)).rejects.toThrow(
      /every file path of a model is used once/,
    )
  })
})

describe("a model's directory", () => {
  const file = (path: string, digit: string) => ({
    path,
    url: `https://example.org/${'0'.repeat(40)}/${path}`,
    bytes: 1,
    sha256: digit.repeat(64),
  })
  const model = (files: Model['files']): Model => ({
    id: 'whisper',
    name: 'Whisper',
    licence: 'MIT',
    source: 'https://example.org/',
    files,
  })
  const b = file('onnx/b.onnx', 'b')
  const a = file('config.json', 'a')
  const two = model([b, a])

  test("is versioned by the first 16 hex digits of the SHA-256 of its sorted '<path> <sha256>' lines", () => {
    const lines = `config.json ${'a'.repeat(64)}\nonnx/b.onnx ${'b'.repeat(64)}\n`
    const expected = createHash('sha256')
      .update(lines)
      .digest('hex')
      .slice(0, 16)

    expect(modelVersion(two)).toBe(expected)
    expect(modelDirectory(two)).toBe(`models/whisper/${expected}/`)
  })

  test('keeps its version whatever order the files are listed in', () => {
    expect(modelVersion(model([a, b]))).toBe(modelVersion(two))
  })

  test.each([
    [
      'one file changes',
      model([file('onnx/b.onnx', 'c'), file('config.json', 'a')]),
    ],
    [
      'one file moves',
      model([file('onnx/c.onnx', 'b'), file('config.json', 'a')]),
    ],
    ['a file is added', model([...two.files, file('vocab.txt', 'd')])],
    ['a file is taken away', model([file('config.json', 'a')])],
  ])('moves to a new version when %s', (_change, changed) => {
    expect(modelVersion(changed)).not.toBe(modelVersion(two))
  })
})

describe('ensureCached', () => {
  test('downloads a file once, then reuses the cached copy', async () => {
    const swiftF0 = await listed()
    const cache = join(scratch, 'cache')

    const first = await ensureCached(swiftF0.id, swiftF0.files[0], cache)
    const fetched = statSync(first)
    const second = await ensureCached(swiftF0.id, swiftF0.files[0], cache)

    expect(second).toBe(first)
    expect(statSync(second).mtimeMs).toBe(fetched.mtimeMs)
    expect(statSync(second).ino).toBe(fetched.ino)
    expect(fetched.size).toBe(swiftF0.files[0].bytes)
  })

  test('fetches again over a cached copy whose hash is wrong', async () => {
    const swiftF0 = await listed()
    const cache = join(scratch, 'cache')
    const path = await ensureCached(swiftF0.id, swiftF0.files[0], cache)
    writeFileSync(path, 'not the model')

    expect(await ensureCached(swiftF0.id, swiftF0.files[0], cache)).toBe(path)
    expect(readFileSync(path).length).toBe(swiftF0.files[0].bytes)
  })

  test('fails naming the file on a hash mismatch, and caches nothing', async () => {
    const {
      id,
      files: [file],
    } = await listed()
    const cache = join(scratch, 'cache')
    const planted = { ...file, sha256: '0'.repeat(64) }

    await expect(ensureCached(id, planted, cache)).rejects.toThrow(
      `Model swift-f0 (model.onnx): SHA-256 mismatch, models.json says ${'0'.repeat(64)}, ${file.url} gave ${file.sha256}`,
    )
    expect(cacheFiles(cache)).toStrictEqual([])
  })

  test('fails naming the file on a size mismatch, and caches nothing', async () => {
    const {
      id,
      files: [file],
    } = await listed()
    const cache = join(scratch, 'cache')

    await expect(
      ensureCached(id, { ...file, bytes: file.bytes + 1 }, cache),
    ).rejects.toThrow(
      `Model swift-f0 (model.onnx): size mismatch, models.json says ${file.bytes + 1} bytes, ${file.url} gave ${file.bytes}`,
    )
    expect(cacheFiles(cache)).toStrictEqual([])
  })
})

describe('the production build', () => {
  test('fails, naming the file, when a listed hash does not match', async () => {
    const swiftF0 = await listed()
    const list = plantList([
      { ...swiftF0, files: [{ ...swiftF0.files[0], sha256: 'f'.repeat(64) }] },
    ])

    await expect(
      productionBuild(
        { build: { write: false } },
        { 'intone:models': models({ list, cache: join(scratch, 'cache') }) },
      ),
    ).rejects.toThrow(/Model swift-f0 \(model\.onnx\): SHA-256 mismatch/)
  })
})
