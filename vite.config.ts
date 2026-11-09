import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

import { contentSecurityPolicyMeta } from './build/content-security-policy.ts'
import { devLibraryGuard } from './build/dev-library-guard.ts'
import { models } from './build/models.ts'
import { onnxRuntime } from './build/onnx-runtime.ts'

export default defineConfig({
  plugins: [
    tailwindcss(),
    foldkit(),
    contentSecurityPolicyMeta(),
    models(),
    onnxRuntime(),
    devLibraryGuard(),
  ],
  optimizeDeps: {
    entries: ['src/app/entry.ts'],
  },
})
