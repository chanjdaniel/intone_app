import type { Plugin } from 'vite'

import { contentSecurityPolicyHeader } from './content-security-policy.ts'
import type { Middleware } from './model-requests.ts'

// The headers both local servers send, as a later host must
// (docs/deploying.md): caching by one table, and the security headers.

export const keptForGood = 'public, max-age=31536000, immutable'
export const revalidated = 'no-cache'

// The paths, below the site's base, whose every file is named by its
// content, so a browser may keep it for a year without asking again. A
// `*` stands for one path segment. Every other path, `index.html` and the
// single-page fallback included, is asked for again each time.
export const cachingTable: ReadonlyArray<
  Readonly<{ path: string; cacheControl: string; why: string }>
> = [
  {
    path: 'models/',
    cacheControl: keptForGood,
    why: "A model directory's version changes when any of its files does.",
  },
  {
    path: 'ort/*/',
    cacheControl: keptForGood,
    why: "ONNX Runtime's release names its directory.",
  },
  {
    path: 'assets/',
    cacheControl: keptForGood,
    why: 'Vite names each built file by a hash of its content.',
  },
]

const patternOf = (path: string): RegExp =>
  new RegExp(
    `^${path
      .split('*')
      .map(part => part.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}`,
  )

const rows = cachingTable.map(row => ({ ...row, pattern: patternOf(row.path) }))

// The Cache-Control of a request's path, the base included.
export const cacheControlOf = (path: string, base: string): string =>
  path.startsWith(base)
    ? (rows.find(row => row.pattern.test(path.slice(base.length)))
        ?.cacheControl ?? revalidated)
    : revalidated

export type Server = 'dev' | 'preview'

// The dev server's client and Foldkit's development tools need more than
// the policy allows, so it sends only nosniff. No server sends a
// cross-origin isolation header: ONNX Runtime runs on one thread.
export const securityHeaders = (server: Server): Record<string, string> =>
  server === 'preview'
    ? {
        'Content-Security-Policy': contentSecurityPolicyHeader,
        'X-Content-Type-Options': 'nosniff',
      }
    : { 'X-Content-Type-Options': 'nosniff' }

const setHeaders =
  (server: Server, base: string): Middleware =>
  (request, response, next) => {
    const path = (request.url ?? '').split('?')[0] ?? ''
    response.setHeader('Cache-Control', cacheControlOf(path, base))
    for (const [name, value] of Object.entries(securityHeaders(server))) {
      response.setHeader(name, value)
    }
    next()
  }

// First of every plugin's handlers, so the model handler, Vite's own and
// `vite preview`'s static files (which keep a header already set) all send
// these. Vite's dev server sets its own Cache-Control on the modules it
// transforms, which do not exist in a build.
export const servingHeaders = (): Plugin => {
  let base = '/'
  return {
    name: 'intone:serving-headers',
    enforce: 'pre',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use(setHeaders('dev', base))
    },
    configurePreviewServer(server) {
      server.middlewares.use(setHeaders('preview', base))
    },
  }
}
