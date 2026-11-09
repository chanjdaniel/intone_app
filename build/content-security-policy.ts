import type { Plugin } from 'vite'

// The app's Content Security Policy: everything from the app's own origin,
// nothing from anywhere else. WebAssembly needs 'wasm-unsafe-eval' to
// compile; no other script relaxation is allowed. The built page carries it
// as a <meta>; Vercel adds it as a header too (ticket 05). A <meta> cannot
// carry frame-ancestors, so that one waits for the header.
export const contentSecurityPolicyDirectives: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'worker-src': ["'self'"],
  'connect-src': ["'self'"],
  'media-src': ["'self'"],
  'img-src': ["'self'"],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
}

export const contentSecurityPolicy = Object.entries(
  contentSecurityPolicyDirectives,
)
  .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
  .join('; ')

// Only the production build: the dev server's injected client and Foldkit's
// development tools need more than the policy allows.
export const contentSecurityPolicyMeta = (): Plugin => ({
  name: 'intone:content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: contentSecurityPolicy,
      },
      injectTo: 'head-prepend',
    },
  ],
})
