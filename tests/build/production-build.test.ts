import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { contentSecurityPolicyDirectives } from '../../build/content-security-policy.ts'
import { modelPath, readModelList } from '../../build/models.ts'
import {
  onnxRuntimeFiles,
  onnxRuntimeVersion,
} from '../../build/onnx-runtime.ts'
import { chunksOf, productionBuild } from '../support/build'
import { root } from '../support/run'

// One real production build with the project's own config, read back from
// its output directory.

let dist = ''
let planted = ''

const files = (): ReadonlyArray<string> =>
  readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dist, join(entry.parentPath, entry.name)))

// A key and its string value in minified code, whichever quotes it chose.
const quotedPair = (key: string, value: string): RegExp =>
  new RegExp(`["'\`]?${key}["'\`]?:\\s*["'\`]${value}["'\`]`)

const sha256 = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex')

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'production-build-'))
  planted = mkdtempSync(join(tmpdir(), 'production-build-entry-'))
  await productionBuild({ build: { outDir: dist, emptyOutDir: true } })
})

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
  rmSync(planted, { recursive: true, force: true })
})

describe('the production build', () => {
  test('carries the Content Security Policy as the first tag of its head', () => {
    const html = readFileSync(join(dist, 'index.html'), 'utf8')
    const meta =
      /<head>\s*<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(
        html,
      )?.[1]
    expect(meta).toBeDefined()
    const policy = Object.fromEntries(
      (meta ?? '')
        .replaceAll('&#39;', "'")
        .split(';')
        .map(directive => directive.trim().split(/\s+/))
        .map(([name = '', ...sources]) => [name, sources]),
    )

    expect(policy).toStrictEqual(contentSecurityPolicyDirectives)
    for (const directive of [
      'default-src',
      'script-src',
      'worker-src',
      'connect-src',
      'media-src',
    ]) {
      expect(
        (policy[directive] ?? []).filter(
          (source: string) =>
            source !== "'self'" && source !== "'wasm-unsafe-eval'",
        ),
        directive,
      ).toStrictEqual([])
    }
    expect(policy['script-src']).toContain("'wasm-unsafe-eval'")
  })

  test('writes each listed model file, checked, under its versioned path', async () => {
    const models = await readModelList(join(root, 'models.json'))
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      const bytes = readFileSync(join(dist, modelPath(model)))
      expect(bytes.length).toBe(model.bytes)
      expect(sha256(bytes)).toBe(model.sha256)
      expect(modelPath(model)).toBe(
        `models/${model.id}/${model.sha256.slice(0, 16)}/${model.file}`,
      )
    }
  })

  test('puts no model bytes in any JavaScript chunk', async () => {
    const models = await readModelList(join(root, 'models.json'))
    const scripts = files()
      .filter(file => /\.m?js$/.test(file))
      .map(file => readFileSync(join(dist, file)))
    expect(scripts.length).toBeGreaterThan(0)
    for (const model of models) {
      const bytes = readFileSync(join(dist, modelPath(model)))
      for (const offset of [
        0,
        Math.floor(bytes.length / 2),
        bytes.length - 48,
      ]) {
        const slice = bytes.subarray(offset, offset + 48)
        for (const script of scripts) {
          expect(script.includes(slice)).toBe(false)
          expect(script.includes(Buffer.from(slice.toString('base64')))).toBe(
            false,
          )
        }
      }
    }
    expect(files().filter(file => file.endsWith('.onnx'))).toStrictEqual(
      models.map(modelPath),
    )
  })

  test("ships ONNX Runtime's WebAssembly from its own origin, unchanged", async () => {
    const version = await onnxRuntimeVersion()
    for (const file of onnxRuntimeFiles) {
      expect(readFileSync(join(dist, 'ort', version, file))).toStrictEqual(
        readFileSync(
          join(root, 'node_modules', 'onnxruntime-web', 'dist', file),
        ),
      )
    }
    expect(files().filter(file => file.endsWith('.wasm'))).toStrictEqual([
      join('ort', version, 'ort-wasm-simd-threaded.wasm'),
    ])
  })

  test('maps each model id and ONNX Runtime to their same-origin URLs', async () => {
    const entry = join(planted, 'reads-the-maps.ts')
    writeFileSync(
      entry,
      [
        "import { modelUrls } from 'virtual:intone/models'",
        "import { onnxRuntimeWasmPaths } from 'virtual:intone/onnx-runtime'",
        'export const read = [modelUrls, onnxRuntimeWasmPaths]',
        '',
      ].join('\n'),
    )
    const models = await readModelList(join(root, 'models.json'))
    const version = await onnxRuntimeVersion()

    for (const base of ['/', '/intone/']) {
      const output = await productionBuild({
        base,
        build: {
          write: false,
          rolldownOptions: { input: entry, preserveEntrySignatures: 'strict' },
        },
      })
      const code = chunksOf(output)
        .map(chunk => chunk.code)
        .join('\n')
      for (const model of models) {
        expect(code).toMatch(quotedPair(model.id, base + modelPath(model)))
      }
      expect(code).toContain(`${base}ort/${version}/`)
    }
  })

  // The app claims only what it compared (report section 3): no text it
  // ships says "accuracy", or that a take is correct. Every text file the
  // build writes is read, libraries and ONNX Runtime's loader included.
  test('ships no text that says "accuracy" or that a take is correct', () => {
    const texts = files().filter(file => /\.(js|mjs|html|css)$/.test(file))
    expect(texts.length).toBeGreaterThan(3)
    for (const file of texts) {
      const code = readFileSync(join(dist, file), 'utf8')
      expect(code, file).not.toMatch(/accura/i)
      expect(code, file).not.toMatch(/\b(in)?correct/i)
    }
    // The score's own words are there to be read.
    expect(
      texts.some(file =>
        readFileSync(join(dist, file), 'utf8').includes('match to this clip'),
      ),
    ).toBe(true)
  })
})
