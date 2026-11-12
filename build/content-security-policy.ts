import type { Plugin } from 'vite'

// The app's Content Security Policy: everything from the app's own origin,
// nothing from anywhere else. WebAssembly needs 'wasm-unsafe-eval' to
// compile; no other script relaxation is allowed. The built page carries it
// as a <meta>, and `vite preview` sends it as a header too, with
// frame-ancestors, which a <meta> cannot carry (build/headers.ts); a later
// host sends the same header (docs/deploying.md). Media may also play from
// a `blob:` URL, which names a file already on the device: a line of the
// learner's own clip plays from the clip store that way.
export const contentSecurityPolicyDirectives: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'worker-src': ["'self'"],
  'connect-src': ["'self'"],
  'media-src': ["'self'", 'blob:'],
  'img-src': ["'self'"],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
}

const policyOf = (
  directives: Readonly<Record<string, ReadonlyArray<string>>>,
): string =>
  Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ')

export const contentSecurityPolicy = policyOf(contentSecurityPolicyDirectives)

// The header's policy: the page's, and no page may frame the app.
export const contentSecurityPolicyHeaderDirectives: Readonly<
  Record<string, ReadonlyArray<string>>
> = { ...contentSecurityPolicyDirectives, 'frame-ancestors': ["'none'"] }

export const contentSecurityPolicyHeader = policyOf(
  contentSecurityPolicyHeaderDirectives,
)

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
