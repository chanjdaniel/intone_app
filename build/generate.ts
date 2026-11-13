import { Schema } from 'effect'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { readModelList } from './models.ts'
import { Lockfile, notices } from './notices.ts'
import { virtualModuleTypes } from './virtual-modules.ts'

// Writes the files generated from package-lock.json and models.json, or,
// with --check, fails naming each one that is not current. CI runs the
// check.
//
//   node build/generate.ts [--check] [--root <directory>]

export const generatedFiles = async (
  root: string,
): Promise<Record<string, string>> => {
  const models = await readModelList(join(root, 'models.json'))
  const lockfile = Schema.decodeSync(Schema.fromJsonString(Lockfile))(
    await readFile(join(root, 'package-lock.json'), 'utf8'),
  )
  return {
    'NOTICES.md': notices(lockfile, models),
    'src/virtual-modules.d.ts': virtualModuleTypes(models),
  }
}

const isMain = process.argv[1] === import.meta.filename

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      root: { type: 'string', default: process.cwd() },
    },
  })
  const root = resolve(values.root)
  const files = Object.entries(await generatedFiles(root))

  if (values.check) {
    const stale: Array<string> = []
    for (const [path, content] of files) {
      const current = await readFile(join(root, path), 'utf8').catch(() => '')
      if (current !== content) {
        stale.push(path)
      }
    }
    if (stale.length > 0) {
      console.error(
        `Not current: ${stale.join(', ')}. Run \`npm run generate\` and commit the result.`,
      )
      process.exit(1)
    }
    console.log(`Current: ${files.map(([path]) => path).join(', ')}.`)
  } else {
    for (const [path, content] of files) {
      await writeFile(join(root, path), content)
    }
    console.log(`Wrote ${files.map(([path]) => path).join(', ')}.`)
  }
}

if (isMain) {
  await main()
}
