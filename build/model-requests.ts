import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { pipeline } from 'node:stream/promises'

// The one handler that answers a request for a model file, in the dev
// server (from the cache) and in `vite preview` (from the build output),
// as a later host must: the content type by extension, its length, and
// one byte range when asked. A path models.json does not list is passed
// on to the next handler. Caching and the security headers are set by
// build/headers.ts, which runs first.

export type Next = (error?: unknown) => void

export type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: Next,
) => void

export const contentTypeOf = (path: string): string => {
  switch (extname(path)) {
    case '.json':
      return 'application/json'
    case '.txt':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

// A request's byte range, inclusive at both ends. A header that is not one
// well-formed range of bytes is ignored, as HTTP allows, and the whole file
// is sent; one that starts past the end cannot be satisfied.
export type Requested =
  | Readonly<{ kind: 'Whole' }>
  | Readonly<{ kind: 'Range'; start: number; end: number }>
  | Readonly<{ kind: 'Unsatisfiable' }>

const whole: Requested = { kind: 'Whole' }
const unsatisfiable: Requested = { kind: 'Unsatisfiable' }

export const requestedRange = (
  header: string | undefined,
  size: number,
): Requested => {
  const spec = /^bytes=\s*(\d*)-(\d*)\s*$/.exec(header ?? '')
  if (spec === null) {
    return whole
  }
  const [, first = '', last = ''] = spec
  if (first === '' && last === '') {
    return whole
  }
  if (first === '') {
    const suffix = Number(last)
    return suffix === 0
      ? unsatisfiable
      : { kind: 'Range', start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(first)
  if (last !== '' && Number(last) < start) {
    return whole
  }
  if (start >= size) {
    return unsatisfiable
  }
  return {
    kind: 'Range',
    start,
    end: last === '' ? size - 1 : Math.min(Number(last), size - 1),
  }
}

const send = async (
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<void> => {
  const { size } = await stat(path)
  const requested = requestedRange(request.headers.range, size)
  response.setHeader('Content-Type', contentTypeOf(path))
  response.setHeader('Accept-Ranges', 'bytes')
  if (requested.kind === 'Unsatisfiable') {
    response.statusCode = 416
    response.setHeader('Content-Range', `bytes */${size}`)
    response.setHeader('Content-Length', '0')
    response.end()
    return
  }
  const { start, end } =
    requested.kind === 'Range' ? requested : { start: 0, end: size - 1 }
  if (requested.kind === 'Range') {
    response.statusCode = 206
    response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  } else {
    response.statusCode = 200
  }
  response.setHeader('Content-Length', String(end - start + 1))
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  await pipeline(createReadStream(path, { start, end }), response)
}

export type ModelRequestOptions = Readonly<{
  base: string
  // Where a listed file is on disk, by its path below the base, or
  // undefined for a path models.json does not list.
  locate: (path: string) => Promise<string | undefined>
}>

export const modelRequestHandler =
  ({ base, locate }: ModelRequestOptions): Middleware =>
  (request, response, next) => {
    const path = (request.url ?? '').split('?')[0] ?? ''
    if (
      !path.startsWith(`${base}models/`) ||
      (request.method !== 'GET' && request.method !== 'HEAD')
    ) {
      next()
      return
    }
    const answer = async (): Promise<void> => {
      const located = await locate(path.slice(base.length))
      if (located === undefined) {
        next()
        return
      }
      await send(request, response, located)
    }
    answer().catch((error: unknown) => {
      if (response.headersSent) {
        // The client went away, or the file failed mid-way: nothing more
        // can be said on this response.
        response.destroy()
      } else {
        next(error)
      }
    })
  }
