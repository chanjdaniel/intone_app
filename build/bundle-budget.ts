import { Schema } from 'effect'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

// The bundle budget: the entry chunk's gzip size against the ceiling in
// bundle-budget.json. CI builds, then runs this, and fails above it.
//
//   node build/bundle-budget.ts [--dist <directory>] [--budget <file>]

export const Budget = Schema.Struct({
  entry: Schema.Struct({
    gzipBytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  }),
})
export type Budget = typeof Budget.Type

export type ChunkSize = Readonly<{ file: string; gzipBytes: number }>

// The entry chunk is the module script the built index.html loads. Gzip is
// measured at level 9, the most a host's compression would give.
export const entryChunkSize = async (dist: string): Promise<ChunkSize> => {
  const html = await readFile(join(dist, 'index.html'), 'utf8')
  const script = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/?([^"]+)"/.exec(
    html,
  )?.[1]
  if (script === undefined) {
    throw new Error(`${join(dist, 'index.html')} loads no module script`)
  }
  const code = await readFile(join(dist, script))
  return { file: script, gzipBytes: gzipSync(code, { level: 9 }).length }
}

export const readBudget = async (path: string): Promise<Budget> =>
  Schema.decodeSync(Schema.fromJsonString(Budget))(await readFile(path, 'utf8'))

const isMain = process.argv[1] === import.meta.filename

if (isMain) {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', default: 'dist' },
      budget: { type: 'string', default: 'bundle-budget.json' },
    },
  })
  const size = await entryChunkSize(resolve(values.dist))
  const budget = await readBudget(resolve(values.budget))
  const line = `Entry chunk ${size.file}: ${size.gzipBytes} B gzip, budget ${budget.entry.gzipBytes} B`
  if (size.gzipBytes > budget.entry.gzipBytes) {
    console.error(
      `${line}: over by ${size.gzipBytes - budget.entry.gzipBytes} B. A raise is justified by a base and a head build (docs/bundle-budget.md).`,
    )
    process.exit(1)
  }
  console.log(`${line}: within it.`)
}
