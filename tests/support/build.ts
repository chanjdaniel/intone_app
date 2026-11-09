import {
  type InlineConfig,
  type Plugin,
  type PluginOption,
  build,
  loadConfigFromFile,
  mergeConfig,
} from 'vite'

import { root } from './run'

export type BuildOutput = Awaited<ReturnType<typeof build>>

const named = (plugin: PluginOption): plugin is Plugin =>
  typeof plugin === 'object' &&
  plugin !== null &&
  !Array.isArray(plugin) &&
  'name' in plugin

const replacing = (
  plugins: ReadonlyArray<PluginOption>,
  replacements: Readonly<Record<string, Plugin>>,
): Array<PluginOption> =>
  plugins.map(plugin =>
    Array.isArray(plugin)
      ? replacing(plugin, replacements)
      : named(plugin)
        ? (replacements[plugin.name] ?? plugin)
        : plugin,
  )

// A real production build with the project's own vite.config.ts, as
// `vite build` runs it. Vitest runs under NODE_ENV=test, which Vite does
// not read as production, so NODE_ENV is production for the build's
// length. `replace` swaps one of the project's plugins, by name, for a
// planted one.
export const productionBuild = async (
  overrides: InlineConfig = {},
  replace: Readonly<Record<string, Plugin>> = {},
): Promise<BuildOutput> => {
  const previous = process.env['NODE_ENV']
  process.env['NODE_ENV'] = 'production'
  try {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production', isPreview: false },
      undefined,
      root,
    )
    if (loaded === null) {
      throw new Error('vite.config.ts did not load')
    }
    const config = {
      ...loaded.config,
      plugins: replacing(loaded.config.plugins ?? [], replace),
    }
    return await build(
      mergeConfig(config, {
        ...overrides,
        root,
        configFile: false,
        logLevel: 'silent',
      }),
    )
  } finally {
    if (previous === undefined) {
      delete process.env['NODE_ENV']
    } else {
      process.env['NODE_ENV'] = previous
    }
  }
}

// The chunks of a `write: false` build, by file name.
export const chunksOf = (
  output: BuildOutput,
): ReadonlyArray<Readonly<{ fileName: string; code: string }>> =>
  (Array.isArray(output) ? output : [output]).flatMap(each =>
    'output' in each
      ? each.output.flatMap(file =>
          file.type === 'chunk'
            ? [{ fileName: file.fileName, code: file.code }]
            : [],
        )
      : [],
  )
