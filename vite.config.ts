import { defaultClientConditions, defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

import { contentSecurityPolicyMeta } from './build/content-security-policy.ts'
import { devLibraryGuard } from './build/dev-library-guard.ts'
import { localPackGuard } from './build/local-pack-guard.ts'
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
    localPackGuard(),
  ],
  resolve: {
    // ONNX Runtime's build that loads its WebAssembly from `wasmPaths`, the
    // copy build/onnx-runtime.ts serves, rather than one with the loader
    // inlined and the 15 MB binary emitted again as a hashed asset.
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  optimizeDeps: {
    entries: ['src/app/entry.ts'],
  },
})
