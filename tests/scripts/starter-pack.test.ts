import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { root, run } from '../support/run.ts'

// The starter pack is what `npm run starter:pack` makes from its list:
// checked as committed with no network and no VOICEVOX, so CI holds it;
// a list changed and not written again is caught; the review's export
// written into the list; and, where every source is in .cache/starter/
// and VOICEVOX CORE is set up, every file made again byte for byte.

const script = (args: ReadonlyArray<string>) =>
  run('node', [
    '--import',
    join(root, 'scripts', 'source-imports.ts'),
    join(root, 'scripts', 'starter-pack.ts'),
    ...args,
  ])

let copy = ''

beforeEach(() => {
  copy = mkdtempSync(join(tmpdir(), 'starter-pack-'))
  cpSync(join(root, 'starter'), join(copy, 'starter'), { recursive: true })
  cpSync(join(root, 'CREDITS.md'), join(copy, 'CREDITS.md'))
})

afterEach(() => {
  rmSync(copy, { recursive: true, force: true })
})

const listPath = () => join(copy, 'starter', 'lines.json')

type RawList = {
  lines: Array<{
    id: string
    text: string
    recording: { kind: string }
    review: unknown
    note?: string
  }>
}

const editList = (edit: (list: RawList) => void): void => {
  const list: RawList = JSON.parse(readFileSync(listPath(), 'utf8'))
  edit(list)
  writeFileSync(listPath(), `${JSON.stringify(list, null, 2)}\n`)
}

const firstCommons = (list: RawList) => {
  const line = list.lines.find(found => found.recording.kind === 'Commons')
  if (line === undefined) throw new Error('no Commons line')
  return line
}

describe('the starter pack', () => {
  test('is current as committed, checked with no network', () => {
    const result = script(['--check'])
    expect(result.status, result.output).toBe(0)
    expect(result.output).toMatch(/^The starter pack is current: \d+ lines\.$/m)
  })

  test('is not current once its list changes, and is again once written', () => {
    editList(list => {
      firstCommons(list).note = 'A note for the reviewer.'
    })
    const stale = script(['--check', '--root', copy])
    expect(stale.status).toBe(1)
    expect(stale.output).toContain('starter/pack/levels.json')

    const written = script(['--root', copy])
    expect(written.status, written.output).toBe(0)
    const again = script(['--check', '--root', copy])
    expect(again.status, again.output).toBe(0)
    expect(
      readFileSync(join(copy, 'starter', 'pack', 'levels.json'), 'utf8'),
    ).toContain('A note for the reviewer.')
  })

  test('refuses a list whose words no longer make its line', () => {
    editList(list => {
      const line = firstCommons(list)
      line.text = `${line.text}よ`
    })
    const result = script(['--check', '--root', copy])
    expect(result.status).toBe(1)
    expect(result.output).toContain('its words make')
  })

  test('takes the review page’s export into the list, and leaves a rejected line out of the pack', () => {
    const list: RawList = JSON.parse(readFileSync(listPath(), 'utf8'))
    const [accepted, rejected] = list.lines.filter(
      line => line.recording.kind === 'Commons',
    )
    if (accepted === undefined || rejected === undefined) {
      throw new Error('fewer than two Commons lines')
    }
    const review = join(copy, 'review.json')
    writeFileSync(
      review,
      JSON.stringify({
        reviewedOn: '2026-12-01',
        reviewer: '山田花子',
        verdicts: [
          { lineId: accepted.id, verdict: 'accept', note: 'clear' },
          { lineId: rejected.id, verdict: 'reject' },
        ],
      }),
    )
    const result = script(['--root', copy, '--apply', review])
    expect(result.status, result.output).toBe(0)

    const after: RawList = JSON.parse(readFileSync(listPath(), 'utf8'))
    expect(
      after.lines.find(line => line.id === accepted.id)?.review,
    ).toStrictEqual({
      verdict: 'accept',
      reviewedOn: '2026-12-01',
      reviewer: '山田花子',
      note: 'clear',
    })
    const pack = readFileSync(
      join(copy, 'starter', 'pack', 'levels.json'),
      'utf8',
    )
    expect(pack).not.toContain(`"id": "${rejected.id}"`)
    expect(
      existsSync(join(copy, 'starter', 'pack', 'audio', `${rejected.id}.wav`)),
    ).toBe(false)
    expect(readFileSync(join(copy, 'CREDITS.md'), 'utf8')).toContain(
      'Checked by 山田花子, a native speaker, on 2026-12-01',
    )
    expect(script(['--check', '--root', copy]).status).toBe(0)
  })

  test('refuses an export that names a line the list has not', () => {
    const review = join(copy, 'review.json')
    writeFileSync(
      review,
      JSON.stringify({
        reviewedOn: '2026-12-01',
        verdicts: [{ lineId: 'no-such-line', verdict: 'accept' }],
      }),
    )
    const before = readFileSync(listPath(), 'utf8')
    const result = script(['--root', copy, '--apply', review])
    expect(result.status).toBe(1)
    expect(result.output).toContain('no-such-line')
    expect(readFileSync(listPath(), 'utf8')).toBe(before)
  })

  // Every source must be at hand: the Commons files in .cache/starter/
  // and VOICEVOX CORE set up (`npm run fixtures:voices-setup`), so CI,
  // which has neither, skips it.
  const committed: RawList = JSON.parse(
    readFileSync(join(root, 'starter', 'lines.json'), 'utf8'),
  )
  const sourcesAtHand =
    existsSync(join(root, '.venv', 'bin', 'python')) &&
    existsSync(join(root, '.cache', 'voicevox', 'models')) &&
    existsSync(join(root, '.cache', 'starter')) &&
    readdirSync(join(root, '.cache', 'starter')).length >=
      committed.lines.filter(line => line.recording.kind !== 'Voicevox').length

  test.skipIf(!sourcesAtHand)(
    'is made again from its sources byte for byte',
    () => {
      const result = script(['--remake', '--check'])
      expect(result.status, result.output).toBe(0)
    },
    300_000,
  )
})
