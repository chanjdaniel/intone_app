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
  type ModelFile,
  ensureCached,
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

const listed = async (): Promise<ModelFile> => {
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
      file: 'model.onnx',
      licence: 'MIT',
      url: expect.stringMatching(
        /^https:\/\/raw\.githubusercontent\.com\/lars76\/swift-f0\/[0-9a-f]{40}\/swift_f0\/model\.onnx$/,
      ),
    })
  })

  test.each([
    [
      'a branch instead of a pinned commit',
      {
        url: 'https://raw.githubusercontent.com/lars76/swift-f0/main/swift_f0/model.onnx',
      },
    ],
    ['a short hash', { sha256: 'abc' }],
    ['no licence', { licence: '' }],
    ['a size that is not a whole number of bytes', { bytes: 1.5 }],
    ['a file name with a path in it', { file: '../model.onnx' }],
  ])('refuses a model with %s', async (_reason, change) => {
    const path = plantList([{ ...(await listed()), ...change }])

    await expect(readModelList(path)).rejects.toThrow()
  })

  test('refuses an id listed twice', async () => {
    const swiftF0 = await listed()
    const path = plantList([swiftF0, { ...swiftF0, file: 'other.onnx' }])

    await expect(readModelList(path)).rejects.toThrow(
      /every model id is used once/,
    )
  })
})

describe('ensureCached', () => {
  test('downloads a file once, then reuses the cached copy', async () => {
    const swiftF0 = await listed()
    const cache = join(scratch, 'cache')

    const first = await ensureCached(swiftF0, cache)
    const fetched = statSync(first)
    const second = await ensureCached(swiftF0, cache)

    expect(second).toBe(first)
    expect(statSync(second).mtimeMs).toBe(fetched.mtimeMs)
    expect(statSync(second).ino).toBe(fetched.ino)
    expect(fetched.size).toBe(swiftF0.bytes)
  })

  test('fetches again over a cached copy whose hash is wrong', async () => {
    const swiftF0 = await listed()
    const cache = join(scratch, 'cache')
    const path = await ensureCached(swiftF0, cache)
    writeFileSync(path, 'not the model')

    expect(await ensureCached(swiftF0, cache)).toBe(path)
    expect(readFileSync(path).length).toBe(swiftF0.bytes)
  })

  test('fails naming the file on a hash mismatch, and caches nothing', async () => {
    const swiftF0 = await listed()
    const cache = join(scratch, 'cache')
    const planted = { ...swiftF0, sha256: '0'.repeat(64) }

    await expect(ensureCached(planted, cache)).rejects.toThrow(
      `Model swift-f0 (model.onnx): SHA-256 mismatch, models.json says ${'0'.repeat(64)}, ${swiftF0.url} gave ${swiftF0.sha256}`,
    )
    expect(cacheFiles(cache)).toStrictEqual([])
  })

  test('fails naming the file on a size mismatch, and caches nothing', async () => {
    const swiftF0 = await listed()
    const cache = join(scratch, 'cache')

    await expect(
      ensureCached({ ...swiftF0, bytes: swiftF0.bytes + 1 }, cache),
    ).rejects.toThrow(
      `Model swift-f0 (model.onnx): size mismatch, models.json says ${swiftF0.bytes + 1} bytes, ${swiftF0.url} gave ${swiftF0.bytes}`,
    )
    expect(cacheFiles(cache)).toStrictEqual([])
  })
})

describe('the production build', () => {
  test('fails, naming the file, when a listed hash does not match', async () => {
    const list = plantList([{ ...(await listed()), sha256: 'f'.repeat(64) }])

    await expect(
      productionBuild(
        { build: { write: false } },
        { 'intone:models': models({ list, cache: join(scratch, 'cache') }) },
      ),
    ).rejects.toThrow(/Model swift-f0 \(model\.onnx\): SHA-256 mismatch/)
  })
})
