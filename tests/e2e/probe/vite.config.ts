import { join } from 'node:path'
import { defineConfig } from 'vite'

import { contentSecurityPolicyMeta } from '../../../build/content-security-policy.ts'

// The fake-microphone probe (tests/e2e/fake-microphone.spec.ts): a
// test-only page that drives the app's own capture worklet and buffer
// source, built apart from the app and never part of its build, under the
// app's Content Security Policy.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [contentSecurityPolicyMeta()],
  build: {
    outDir: join(import.meta.dirname, '..', '..', '..', '.cache', 'e2e-probe'),
    emptyOutDir: true,
  },
  logLevel: 'warn',
})
