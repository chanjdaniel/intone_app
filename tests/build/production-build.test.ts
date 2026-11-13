import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { contentSecurityPolicyDirectives } from '../../build/content-security-policy.ts'
import {
  modelDirectory,
  modelVersion,
  readModelList,
  servedModelFiles,
} from '../../build/models.ts'
import {
  onnxRuntimeFiles,
  onnxRuntimeVersion,
  textRuntimeFiles,
  textRuntimeVersion,
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

// A string in minified code, whichever quotes it chose.
const quoted = (value: string): RegExp => new RegExp(`["'\`]${value}["'\`]`)

// A key and its string value in minified code, whichever quotes it chose.
const quotedPair = (key: string, value: string): RegExp =>
  new RegExp(
    `["'\`]?${key}["'\`]?:\\s*["'\`]${value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}["'\`]`,
  )

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
    // A file on the device, a line of the learner's own clip, plays from
    // a blob: URL; nothing else is allowed beside the app's own origin.
    expect(policy['media-src']).toStrictEqual(["'self'", 'blob:'])
  })

  test("writes every file of every model, checked, in its model's directory", async () => {
    const models = await readModelList(join(root, 'models.json'))
    expect(models.length).toBeGreaterThan(0)
    for (const { model, file, path } of servedModelFiles(models)) {
      const bytes = readFileSync(join(dist, path))
      expect(bytes.length).toBe(file.bytes)
      expect(sha256(bytes)).toBe(file.sha256)
      expect(path).toBe(
        `models/${model.id}/${modelVersion(model)}/${file.path}`,
      )
    }
    expect(
      files()
        .filter(file => file.startsWith(`models${sep}`))
        .sort(),
    ).toStrictEqual(
      servedModelFiles(models)
        .map(({ path }) => join(path))
        .sort(),
    )
  })

  test('puts no model bytes in any JavaScript chunk', async () => {
    const models = await readModelList(join(root, 'models.json'))
    const scripts = files()
      .filter(file => /\.m?js$/.test(file))
      .map(file => readFileSync(join(dist, file)))
    expect(scripts.length).toBeGreaterThan(0)
    for (const { path } of servedModelFiles(models)) {
      const bytes = readFileSync(join(dist, path))
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
    expect(
      files()
        .filter(file => file.endsWith('.onnx'))
        .sort(),
    ).toStrictEqual(
      servedModelFiles(models)
        .map(({ path }) => join(path))
        .filter(path => path.endsWith('.onnx'))
        .sort(),
    )
  })

  test("ships both ONNX Runtime builds' WebAssembly and Lindera's from its own origin, unchanged", async () => {
    const version = await onnxRuntimeVersion()
    for (const file of onnxRuntimeFiles) {
      expect(readFileSync(join(dist, 'ort', version, file))).toStrictEqual(
        readFileSync(
          join(root, 'node_modules', 'onnxruntime-web', 'dist', file),
        ),
      )
    }
    // Transformers.js pins its own ONNX Runtime, installed beside it.
    const textVersion = await textRuntimeVersion()
    for (const file of textRuntimeFiles) {
      expect(readFileSync(join(dist, 'ort', textVersion, file))).toStrictEqual(
        readFileSync(
          join(
            root,
            'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist',
            file,
          ),
        ),
      )
    }
    const wasm = files()
      .filter(file => file.endsWith('.wasm'))
      .sort()
    expect(wasm.filter(file => file.startsWith('ort'))).toStrictEqual(
      [
        join('ort', version, 'ort-wasm-simd-threaded.wasm'),
        join('ort', textVersion, 'ort-wasm-simd-threaded.asyncify.wasm'),
      ].sort(),
    )
    // Lindera's, which the bundler emits beside the readings Worker under
    // a hashed name.
    const lindera = wasm.filter(file => !file.startsWith('ort'))
    expect(lindera).toHaveLength(1)
    expect(lindera[0]).toMatch(/^assets\/lindera_wasm_bg-[\w-]{8}\.wasm$/)
    expect(readFileSync(join(dist, lindera[0] ?? ''))).toStrictEqual(
      readFileSync(
        join(root, 'node_modules', 'lindera-wasm', 'lindera_wasm_bg.wasm'),
      ),
    )
  })

  test('maps each model id to its directory, each one-file model to its file, and ONNX Runtime to its directory, all same-origin', async () => {
    const entry = join(planted, 'reads-the-maps.ts')
    writeFileSync(
      entry,
      [
        "import { modelCredits, modelDirectories, modelFiles, modelUrls, modelVersions, modelsRoot } from 'virtual:intone/models'",
        "import { onnxRuntimeWasmPaths, textRuntimeWasmPaths } from 'virtual:intone/onnx-runtime'",
        'export const read = [modelCredits, modelDirectories, modelFiles, modelUrls, modelVersions, modelsRoot, onnxRuntimeWasmPaths, textRuntimeWasmPaths]',
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
        expect(code).toMatch(quotedPair(model.id, base + modelDirectory(model)))
        if (model.files.length === 1) {
          expect(code).toMatch(
            quotedPair(
              model.id,
              base + modelDirectory(model) + model.files[0].path,
            ),
          )
        }
      }
      expect(code).toContain(`${base}ort/${version}/`)
      expect(code).toContain(`${base}ort/${await textRuntimeVersion()}/`)
      expect(code).toMatch(quoted(`${base}models/`))
      for (const model of models) {
        expect(code).toMatch(quotedPair(model.id, modelVersion(model)))
        for (const file of model.files) {
          expect(code).toMatch(
            new RegExp(
              `${quotedPair('path', file.path).source},\\s*["'\`]?bytes["'\`]?:\\s*${file.bytes}\\b`,
            ),
          )
        }
        expect(code).toMatch(quotedPair('licence', model.licence))
        expect(code).toMatch(quotedPair('source', model.source))
      }
    }
  })

  // The app claims only what it compared (report section 3): no text it
  // ships says "accuracy", or that a take is correct. Every text file the
  // build writes is read, libraries and ONNX Runtime's loader included.
  test('ships the notices of every package and model file it carries, as NOTICES.md', () => {
    expect(readFileSync(join(dist, 'NOTICES.md'), 'utf8')).toBe(
      readFileSync(join(root, 'NOTICES.md'), 'utf8'),
    )
  })

  // Transformers.js's own words to a developer, in the text Worker: two
  // warnings to the console, of its tokenizer and its timestamps, and one
  // error, which the Worker writes to the console and says in its own
  // words on screen (src/workers/whisper-session.ts).
  const libraryWarnings = [
    'you may experience slightly inaccurate results',
    'This may lead to inaccurate token-level timestamps',
    'Incorrect state encountered during generation.',
  ]

  test('ships no text that says "accuracy" or that a take is correct', () => {
    const texts = files().filter(file => /\.(js|mjs|html|css)$/.test(file))
    expect(texts.length).toBeGreaterThan(3)
    for (const file of texts) {
      const code = libraryWarnings.reduce(
        (read, warning) => read.replaceAll(warning, ''),
        readFileSync(join(dist, file), 'utf8'),
      )
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
