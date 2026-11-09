import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

import { readModelList } from '../../build/models.ts'
import { root, run } from '../support/run'

// Model files and ONNX Runtime's WebAssembly reach the app only through the
// build's URL maps, and no model file is committed.

const sourceFiles = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(ts|css|html)$/.test(entry.name))
    .map(entry => relative(root, join(entry.parentPath, entry.name)))

describe('asset paths', () => {
  test('no source file hard-codes a model or ONNX Runtime path', () => {
    const offenders = [...sourceFiles(join(root, 'src')), 'index.html'].filter(
      file =>
        /\/models\/|\.onnx\b|ort-wasm|\/ort\//.test(
          readFileSync(join(root, file), 'utf8'),
        ),
    )

    expect(offenders).toStrictEqual([])
  })

  test('git holds no model file', async () => {
    const models = await readModelList(join(root, 'models.json'))
    const tracked = run('git', ['ls-files', '-z'])
      .stdout.split('\0')
      .filter(Boolean)
    const sizes = new Set(models.map(model => model.bytes))
    const hashes = new Set(models.map(model => model.sha256))

    const isModelFile = (file: string): boolean => {
      const path = join(root, file)
      const found = statSync(path, { throwIfNoEntry: false })
      return (
        /\.(onnx|ort|safetensors)$/.test(file) ||
        (found?.isFile() === true &&
          sizes.has(found.size) &&
          hashes.has(
            createHash('sha256').update(readFileSync(path)).digest('hex'),
          ))
      )
    }
    const committed = tracked.filter(isModelFile)

    expect(committed).toStrictEqual([])
  })
})
