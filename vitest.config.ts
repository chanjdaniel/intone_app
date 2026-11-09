import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // The app's own unit, Story and Scene tests, beside their code.
        test: {
          name: 'src',
          include: ['src/**/*.{test,spec}.ts'],
          environment: 'happy-dom',
          setupFiles: ['./src/app/vitest-setup.ts'],
          server: {
            deps: {
              inline: ['foldkit', '@foldkit/ui', '@foldkit/devtools'],
            },
          },
        },
      },
      {
        // Tests of the repository's own tooling, which run its lint, type
        // check, build and scripts as child processes in Node.
        test: {
          name: 'tooling',
          include: ['tests/{lint,build,scripts}/**/*.test.ts'],
          environment: 'node',
          testTimeout: 180_000,
        },
      },
    ],
  },
})
