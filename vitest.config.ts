import { defineConfig } from 'vitest/config'

import { models } from './build/models.ts'
import { onnxRuntime } from './build/onnx-runtime.ts'

export default defineConfig({
  test: {
    projects: [
      {
        // The app's own unit, Story and Scene tests, beside their code.
        // The build's virtual modules resolve here as in the app; nothing
        // is downloaded until a test fetches a model's URL.
        plugins: [models(), onnxRuntime()],
        test: {
          name: 'src',
          include: ['src/**/*.{test,spec}.ts'],
          environment: 'happy-dom',
          setupFiles: ['./src/app/vitest-setup.ts'],
          // Vitest empties every CSS import unless told otherwise; the /dev
          // library's tokens entry reads styles.css as text.
          css: { include: [/styles\.css\?raw$/] },
          server: {
            deps: {
              inline: ['foldkit', '@foldkit/ui', '@foldkit/devtools'],
            },
          },
        },
      },
      {
        // Tests of the repository's own tooling, which run its lint, type
        // check, build and scripts as child processes in Node, and of the
        // measuring code the end-to-end tests share (tests/support), and
        // of the tracker on the real SwiftF0 model (tests/tracker), and of
        // the score on the fixtures' tracked curves (tests/score).
        test: {
          name: 'tooling',
          include: [
            'tests/{lint,build,scripts,support,tracker,score}/**/*.test.ts',
          ],
          environment: 'node',
          testTimeout: 180_000,
          // They run the project's own lint, whose first step may patch the
          // oxlint binary in node_modules, and its build: one file at a time.
          fileParallelism: false,
        },
      },
    ],
  },
})
