import { Schema } from 'effect'
import { readFile, readdir } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

// The bundle budget: the gzip size of the JavaScript the page loads before
// it can start, the entry chunk and every chunk it imports statically,
// and of every other chunk on its own (each Worker, the worklet, each
// lazily loaded chunk, ONNX Runtime's WebAssembly and its loader), each
// against its line in bundle-budget.json. CI builds, then runs this, and
// fails above a line, on a chunk with no line, or on a line with no chunk.
//
//   node build/bundle-budget.ts [--dist <directory>] [--budget <file>]

const Line = Schema.Struct({
  gzipBytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
})

export const Budget = Schema.Struct({
  entry: Line,
  // By chunk name: a built file's name without its content hash.
  chunks: Schema.Record(Schema.String, Line),
})
export type Budget = typeof Budget.Type

export type ChunkSize = Readonly<{
  file: string
  // The chunks the entry imports statically, directly or through each
  // other, which the page loads before it starts.
  imports: ReadonlyArray<string>
  gzipBytes: number
}>

// A chunk's static imports of other chunks, `import ... from "./x.js"`
// and `import "./x.js"` (and their `export ... from`), never `import()`.
const staticImportsOf = (code: string): ReadonlyArray<string> =>
  [
    ...code.matchAll(
      /(?:^|[;\s}])(?:import|export)\s*(?:[^"'`();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g,
    ),
  ].flatMap(match => (match[1] === undefined ? [] : [match[1]]))

// Every chunk `file` imports statically, through each other.
const importedChunks = async (
  dist: string,
  file: string,
): Promise<ReadonlyArray<string>> => {
  const seen = new Set<string>([file])
  const visit = async (chunk: string): Promise<void> => {
    const code = await readFile(join(dist, chunk), 'utf8')
    const found = staticImportsOf(code)
      .map(specifier => posix.join(posix.dirname(chunk), specifier))
      .filter(imported => !seen.has(imported))
    found.forEach(imported => seen.add(imported))
    await Promise.all(found.map(visit))
  }
  await visit(file)
  return [...seen].filter(chunk => chunk !== file)
}

const gzipBytesOf = async (dist: string, file: string): Promise<number> =>
  gzipSync(await readFile(join(dist, file)), { level: 9 }).length

// The entry chunk is the module script the built index.html loads; the
// page loads it and the chunks it imports statically before it starts,
// each gzipped on its own, as a host sends them. Gzip is measured at
// level 9, the most a host's compression would give.
export const entryChunkSize = async (dist: string): Promise<ChunkSize> => {
  const html = await readFile(join(dist, 'index.html'), 'utf8')
  const script = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/?([^"]+)"/.exec(
    html,
  )?.[1]
  if (script === undefined) {
    throw new Error(`${join(dist, 'index.html')} loads no module script`)
  }
  const imports = await importedChunks(dist, script)
  const sizes = await Promise.all(
    [script, ...imports].map(file => gzipBytesOf(dist, file)),
  )
  return {
    file: script,
    imports,
    gzipBytes: sizes.reduce((total, size) => total + size, 0),
  }
}

export type LazyChunkSize = Readonly<{
  // The file's name without Vite's content hash: `tracker.worker`.
  name: string
  file: string
  gzipBytes: number
}>

// A built chunk's name: `assets/tracker.worker-CbN21Jdx.js` is
// `tracker.worker`, and `assets/lindera_wasm_bg-BbaAsae8.wasm`
// `lindera_wasm_bg`; ONNX Runtime's files keep their own names.
const nameOf = (file: string): string =>
  posix.basename(file).replace(/-[\w-]{8}\.(js|wasm)$/, '')

// Every chunk the page does not load at start, each on its own: the
// JavaScript in assets/ outside the entry and its static imports, the
// WebAssembly the bundler emits there beside a package's module
// (Lindera's), and ONNX Runtime's files under ort/<version>/.
export const lazyChunkSizes = async (
  dist: string,
): Promise<ReadonlyArray<LazyChunkSize>> => {
  const entry = await entryChunkSize(dist)
  const atStart = new Set([entry.file, ...entry.imports])
  const assets = (await readdir(join(dist, 'assets')))
    .filter(file => file.endsWith('.js') || file.endsWith('.wasm'))
    .map(file => posix.join('assets', file))
    .filter(file => !atStart.has(file))
  const ort = (
    await readdir(join(dist, 'ort'), { recursive: true, withFileTypes: true })
  )
    .filter(entry_ => entry_.isFile())
    .map(entry_ =>
      posix.join(
        'ort',
        posix.relative(join(dist, 'ort'), join(entry_.parentPath, entry_.name)),
      ),
    )
  return Promise.all(
    [...assets, ...ort].map(async file => ({
      name: nameOf(file),
      file,
      gzipBytes: await gzipBytesOf(dist, file),
    })),
  )
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
  const dist = resolve(values.dist)
  const size = await entryChunkSize(dist)
  const budget = await readBudget(resolve(values.budget))
  const imported =
    size.imports.length === 0
      ? ''
      : ` and the ${size.imports.length} it imports (${size.imports.join(', ')})`
  const problems: Array<string> = []
  const line = `Entry chunk ${size.file}${imported}: ${size.gzipBytes} B gzip, budget ${budget.entry.gzipBytes} B`
  if (size.gzipBytes > budget.entry.gzipBytes) {
    problems.push(
      `${line}: over by ${size.gzipBytes - budget.entry.gzipBytes} B.`,
    )
  } else {
    console.log(`${line}: within it.`)
  }
  const chunks = await lazyChunkSizes(dist)
  for (const chunk of chunks) {
    const cap = budget.chunks[chunk.name]?.gzipBytes
    const said = `Chunk ${chunk.name} (${chunk.file}): ${chunk.gzipBytes} B gzip`
    if (cap === undefined) {
      problems.push(`Chunk ${chunk.name} (${chunk.file}) has no budget line.`)
    } else if (chunk.gzipBytes > cap) {
      problems.push(
        `${said}, budget ${cap} B: over by ${chunk.gzipBytes - cap} B.`,
      )
    } else {
      console.log(`${said}, budget ${cap} B: within it.`)
    }
  }
  const made = new Set(chunks.map(chunk => chunk.name))
  for (const name of Object.keys(budget.chunks)) {
    if (!made.has(name)) {
      problems.push(`Budget line ${name} names no chunk the build makes.`)
    }
  }
  if (problems.length > 0) {
    problems.forEach(problem => console.error(problem))
    console.error(
      'A raise or a new line is justified by a base and a head build (docs/bundle-budget.md).',
    )
    process.exit(1)
  }
}
