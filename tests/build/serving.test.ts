import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type PreviewServer,
  type ViteDevServer,
  createServer,
  preview,
} from 'vite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { contentSecurityPolicyHeaderDirectives } from '../../build/content-security-policy.ts'
import {
  type Model,
  readModelList,
  servedModelFiles,
} from '../../build/models.ts'
import {
  onnxRuntimeDirectory,
  onnxRuntimeFiles,
  onnxRuntimeVersion,
} from '../../build/onnx-runtime.ts'
import { productionBuild } from '../support/build'
import { root } from '../support/run'

// The two local servers, by HTTP, with the project's own config: the dev
// server, and `vite preview` of a real production build, which is how
// Daniel runs the app and how a later host must serve it.

const configFile = join(root, 'vite.config.ts')
const keptForGood = 'public, max-age=31536000, immutable'
const isolationHeaders = [
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
]

let dist = ''
let devServer: ViteDevServer | undefined
let previewServer: PreviewServer | undefined
let origins: Readonly<Record<'dev' | 'preview', string>> = {
  dev: '',
  preview: '',
}
let models: ReadonlyArray<Model> = []

const originOf = (address: AddressInfo | string | null | undefined): string => {
  if (
    address === null ||
    address === undefined ||
    typeof address === 'string'
  ) {
    throw new Error(`no port in ${String(address)}`)
  }
  return `http://127.0.0.1:${address.port}`
}

beforeAll(async () => {
  models = await readModelList(join(root, 'models.json'))
  dist = mkdtempSync(join(tmpdir(), 'serving-'))
  await productionBuild({ build: { outDir: dist, emptyOutDir: true } })
  const listening = await preview({
    configFile,
    root,
    logLevel: 'silent',
    build: { outDir: dist },
    preview: { host: '127.0.0.1', port: 0, open: false },
  })
  previewServer = listening
  const dev = await createServer({
    configFile,
    root,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, open: false, ws: false },
  })
  devServer = await dev.listen()
  origins = {
    dev: originOf(devServer.httpServer?.address()),
    preview: originOf(listening.httpServer.address()),
  }
})

afterAll(async () => {
  await devServer?.close()
  await previewServer?.close()
  rmSync(dist, { recursive: true, force: true })
})

const whisperDecoder = (): Readonly<{
  path: string
  bytes: number
  sha256: string
}> => {
  const found = servedModelFiles(models).find(
    each =>
      each.model.id === 'whisper-small' &&
      each.file.path === 'onnx/decoder_model_merged_int8.onnx',
  )
  if (found === undefined) {
    throw new Error("models.json lists no whisper-small's merged decoder")
  }
  return { ...found.file, path: found.path }
}

const sha256 = (bytes: ArrayBuffer): string =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex')

describe.each(['dev', 'preview'] as const)('the %s server', server => {
  test("serves whisper-small's 149.5 MiB merged decoder whole", async () => {
    const decoder = whisperDecoder()
    expect(decoder.bytes).toBe(156_750_845)

    const response = await fetch(`${origins[server]}/${decoder.path}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream',
    )
    expect(response.headers.get('content-length')).toBe(String(decoder.bytes))
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toBe(keptForGood)
    const body = await response.arrayBuffer()
    expect(body.byteLength).toBe(decoder.bytes)
    expect(sha256(body)).toBe(decoder.sha256)
  })

  test('serves every file of every model, by its model directory', async () => {
    for (const { path, file } of servedModelFiles(models)) {
      const response = await fetch(`${origins[server]}/${path}`, {
        method: 'HEAD',
      })
      expect(response.status, path).toBe(200)
      expect(response.headers.get('content-length'), path).toBe(
        String(file.bytes),
      )
    }
  })

  test("serves ONNX Runtime's files with their type and length", async () => {
    const ort = `/${onnxRuntimeDirectory(await onnxRuntimeVersion())}`
    for (const file of onnxRuntimeFiles) {
      // Uncompressed, so its length is the file's: `vite preview`
      // compresses text for a client that accepts it.
      const response = await fetch(`${origins[server]}${ort}${file}`, {
        headers: { 'Accept-Encoding': 'identity' },
      })
      const body = await response.arrayBuffer()
      expect(response.status, file).toBe(200)
      expect(response.headers.get('content-type'), file).toBe(
        file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      )
      expect(response.headers.get('content-length'), file).toBe(
        String(body.byteLength),
      )
    }
  })

  test('answers one byte range with 206 and an unsatisfiable one with 416', async () => {
    const decoder = whisperDecoder()
    const url = `${origins[server]}/${decoder.path}`
    const whole = Buffer.from(
      readFileSync(
        join(
          root,
          '.cache',
          'models',
          decoder.sha256,
          'decoder_model_merged_int8.onnx',
        ),
      ),
    )

    const tail = await fetch(url, { headers: { Range: 'bytes=156000000-' } })
    expect(tail.status).toBe(206)
    expect(tail.headers.get('content-range')).toBe(
      `bytes 156000000-${decoder.bytes - 1}/${decoder.bytes}`,
    )
    expect(Buffer.from(await tail.arrayBuffer())).toStrictEqual(
      whole.subarray(156_000_000),
    )

    const past = await fetch(url, {
      headers: { Range: `bytes=${decoder.bytes}-` },
    })
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe(`bytes */${decoder.bytes}`)
  })

  test('answers a path under a kept-for-good directory that nothing serves with a 404 asked for again, never the page', async () => {
    const [first] = models
    if (first === undefined) {
      throw new Error('models.json lists no model')
    }
    const ort = await onnxRuntimeVersion()
    for (const path of [
      `/models/${first.id}/0000000000000000/${first.files[0].path}`,
      '/assets/missing-0000.js',
      `/ort/${ort}/missing.wasm`,
    ]) {
      for (const accept of ['*/*', 'text/html', 'application/octet-stream']) {
        const response = await fetch(`${origins[server]}${path}`, {
          headers: { Accept: accept },
        })
        expect(response.status, `${path} ${accept}`).toBe(404)
        expect(response.headers.get('cache-control'), `${path} ${accept}`).toBe(
          'no-cache',
        )
      }
    }
  })

  test('names an icon in the page, and serves it, so no page asks for a missing /favicon.ico', async () => {
    const page = await (await fetch(`${origins[server]}/`)).text()
    const href = /<link rel="icon" href="([^"]+)"/.exec(page)?.[1]
    expect(href).toBeDefined()
    const response = await fetch(`${origins[server]}${href}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^image\/svg\+xml/)
    expect(await response.text()).toContain('<svg')
  })

  test('sends nosniff and no cross-origin isolation header', async () => {
    const [model] = servedModelFiles(models)
    for (const path of ['/', `/${model?.path}`]) {
      const response = await fetch(`${origins[server]}${path}`)
      expect(response.headers.get('x-content-type-options'), path).toBe(
        'nosniff',
      )
      for (const header of isolationHeaders) {
        expect(response.headers.get(header), `${path} ${header}`).toBeNull()
      }
    }
  })
})

describe('the dev server', () => {
  test('sends no Content Security Policy, which its own client would break', async () => {
    const response = await fetch(`${origins.dev}/`)

    expect(response.headers.get('content-security-policy')).toBeNull()
  })
})

describe('vite preview', () => {
  const headersOf = async (path: string): Promise<Headers> => {
    const response = await fetch(`${origins.preview}${path}`)
    expect(response.status, path).toBe(200)
    await response.arrayBuffer()
    return response.headers
  }

  const hashedAsset = (): string => {
    const script = /<script type="module" crossorigin src="([^"]+)"/.exec(
      readFileSync(join(dist, 'index.html'), 'utf8'),
    )?.[1]
    if (script === undefined || !script.startsWith('/assets/')) {
      throw new Error(`index.html loads no script from /assets/: ${script}`)
    }
    return script
  }

  test('caches the files named by their content for good, and asks again for every other', async () => {
    const ort = `/${onnxRuntimeDirectory(await onnxRuntimeVersion())}`
    const [model] = servedModelFiles(models)
    const cases: ReadonlyArray<readonly [string, string]> = [
      [`/${model?.path}`, keptForGood],
      [`${ort}${onnxRuntimeFiles[0]}`, keptForGood],
      [`${ort}${onnxRuntimeFiles[1]}`, keptForGood],
      [hashedAsset(), keptForGood],
      ['/', 'no-cache'],
      ['/index.html', 'no-cache'],
      // The single-page fallback: a route of the app, answered by index.html.
      ['/history', 'no-cache'],
      ['/manifest.webmanifest', 'no-cache'],
    ]

    for (const [path, cacheControl] of cases) {
      expect((await headersOf(path)).get('cache-control'), path).toBe(
        cacheControl,
      )
    }
    expect(await (await fetch(`${origins.preview}/history`)).text()).toContain(
      '<div id="root"',
    )
  })

  test('sends the Content Security Policy, frame-ancestors included, on the page and every file', async () => {
    const parsed = (
      header: string | null,
    ): Record<string, ReadonlyArray<string>> =>
      Object.fromEntries(
        (header ?? '')
          .split(';')
          .map(directive => directive.trim().split(/\s+/))
          .map(([name = '', ...sources]) => [name, sources]),
      )

    for (const path of ['/', '/history', hashedAsset()]) {
      const headers = await headersOf(path)
      expect(
        parsed(headers.get('content-security-policy')),
        path,
      ).toStrictEqual(contentSecurityPolicyHeaderDirectives)
      expect(headers.get('x-content-type-options'), path).toBe('nosniff')
    }
    expect(
      contentSecurityPolicyHeaderDirectives['frame-ancestors'],
    ).toStrictEqual(["'none'"])
  })
})
