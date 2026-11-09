import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Shared by the tooling tests, which drive the project's own commands as
// child processes.

export const root = join(import.meta.dirname, '..', '..')

export type Run = {
  status: number | null
  stdout: string
  // stdout and stderr together, for assertions and failure messages.
  output: string
}

// Runs a command to its end, with no shell, from the repository's root
// unless told otherwise. Throws only when the command cannot start.
export const run = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Run => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: options.env ?? process.env,
  })
  if (result.error !== undefined) throw result.error
  return {
    status: result.status,
    stdout: result.stdout,
    output: result.stdout + result.stderr,
  }
}
