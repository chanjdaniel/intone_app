import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { modelRequestHandler } from '../../build/model-requests.ts'

// The model handler alone, on a plain Node server over planted files, by
// HTTP. tests/build/serving.test.ts reads it through the real servers.

let scratch = ''
let server: Server | undefined
let origin = ''
const passedOn: Array<string> = []
const failures: Array<string> = []

// 0, 1, ..., 255, 0, 1, ... so any byte's value is its offset modulo 256.
const counting = (length: number): Buffer =>
  Buffer.from(Array.from({ length }, (_, index) => index % 256))

const planted: Readonly<Record<string, Buffer>> = {
  'm/1/model.onnx': counting(1000),
  'm/1/onnx/decoder.onnx': counting(300),
  'm/1/config.json': Buffer.from('{"a":1}'),
  'm/1/vocab.txt': Buffer.from('あい\n'),
  'm/1/tokenizer.model': counting(10),
  // Listed, but not on disk.
  'm/1/missing.onnx': Buffer.alloc(0),
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'model-requests-'))
  for (const [path, bytes] of Object.entries(planted)) {
    if (!path.endsWith('missing.onnx')) {
      mkdirSync(join(scratch, path, '..'), { recursive: true })
      writeFileSync(join(scratch, path), bytes)
    }
  }
  const handler = modelRequestHandler({
    base: '/base/',
    locate: async path =>
      path.startsWith('models/') && path.slice('models/'.length) in planted
        ? join(scratch, path.slice('models/'.length))
        : undefined,
  })
  const listening = createServer((request, response) =>
    handler(request, response, error => {
      if (error === undefined) {
        passedOn.push(request.url ?? '')
        response.statusCode = 404
      } else {
        failures.push(String(error))
        response.statusCode = 500
      }
      response.end()
    }),
  )
  server = listening
  await new Promise<void>(done => listening.listen(0, '127.0.0.1', done))
  const address = listening.address()
  if (address === null || typeof address === 'string') {
    throw new Error(`no port in ${String(address)}`)
  }
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise(done => server?.close(done))
  rmSync(scratch, { recursive: true, force: true })
})

const get = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${origin}/base/models/${path}`, init)

const ranged = (path: string, range: string): Promise<Response> =>
  get(path, { headers: { Range: range } })

describe('a model file', () => {
  test.each([
    ['m/1/model.onnx', 'application/octet-stream'],
    ['m/1/onnx/decoder.onnx', 'application/octet-stream'],
    ['m/1/config.json', 'application/json'],
    ['m/1/vocab.txt', 'text/plain; charset=utf-8'],
    ['m/1/tokenizer.model', 'application/octet-stream'],
  ])('%s is sent whole as %s', async (path, type) => {
    const response = await get(path)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(type)
    expect(response.headers.get('content-length')).toBe(
      String(planted[path]?.length),
    )
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await response.arrayBuffer())).toStrictEqual(
      planted[path],
    )
  })

  test('answers HEAD with the headers and no body', async () => {
    const response = await get('m/1/model.onnx', { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('1000')
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream',
    )
    expect((await response.arrayBuffer()).byteLength).toBe(0)
  })
})

describe('a byte range', () => {
  test.each([
    ['bytes=0-99', 0, 99],
    ['bytes=500-', 500, 999],
    ['bytes=-10', 990, 999],
    ['bytes=-5000', 0, 999],
    ['bytes=990-5000', 990, 999],
    ['bytes=999-999', 999, 999],
  ])('%s is answered 206 with bytes %i to %i', async (range, start, end) => {
    const response = await ranged('m/1/model.onnx', range)

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(
      `bytes ${start}-${end}/1000`,
    )
    expect(response.headers.get('content-length')).toBe(String(end - start + 1))
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream',
    )
    expect(Buffer.from(await response.arrayBuffer())).toStrictEqual(
      counting(1000).subarray(start, end + 1),
    )
  })

  test.each(['bytes=1000-', 'bytes=5000-6000', 'bytes=-0'])(
    '%s cannot be satisfied: 416, naming the size',
    async range => {
      const response = await ranged('m/1/model.onnx', range)

      expect(response.status).toBe(416)
      expect(response.headers.get('content-range')).toBe('bytes */1000')
      expect((await response.arrayBuffer()).byteLength).toBe(0)
    },
  )

  test.each([
    'bytes=0-1,5-6',
    'bytes=9-3',
    'items=0-1',
    'bytes=-',
    'bytes=a-b',
  ])(
    '%s is not one well-formed range, so the whole file is sent',
    async range => {
      const response = await ranged('m/1/model.onnx', range)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-range')).toBeNull()
      expect((await response.arrayBuffer()).byteLength).toBe(1000)
    },
  )
})

describe('anything else', () => {
  test.each([
    ['a path models.json does not list', '/base/models/m/1/other.onnx'],
    ['a path outside models/', '/base/assets/model.onnx'],
    ['a path outside the base', '/models/m/1/model.onnx'],
  ])('passes %s on to the next handler', async (_reason, path) => {
    passedOn.length = 0
    const response = await fetch(`${origin}${path}`)

    expect(response.status).toBe(404)
    expect(passedOn).toStrictEqual([path])
  })

  test('passes on a request that is neither GET nor HEAD', async () => {
    passedOn.length = 0
    const response = await get('m/1/model.onnx', { method: 'POST', body: 'x' })

    expect(response.status).toBe(404)
    expect(passedOn).toStrictEqual(['/base/models/m/1/model.onnx'])
  })

  test('hands a listed file it cannot read to the next handler as an error', async () => {
    failures.length = 0
    const response = await get('m/1/missing.onnx')

    expect(response.status).toBe(500)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/ENOENT/)
  })
})
