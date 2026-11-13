import { strFromU8, unzipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'

import {
  generateHistory,
  generatedBackup,
  historyFixture,
} from '../support/history-fixture.ts'

// The long history the history screens are tested at, made from its seed
// through the app's own Schemas: the same file every run, its counts
// pinned. A change to the score or the backup's format moves the hash;
// check the history still has the counts below, then pin the new hash.
const pinnedSha256 =
  'd939eb0e4e1a182d18196e88b54116afa26ede54f9d7fd4800fe92fb293d6b61'

describe('the generated history', () => {
  const history = generateHistory()
  const backup = generatedBackup(history)

  test('holds the takes, lines and natives it says, on the days dealt', () => {
    const { takes, natives } = history.dump
    expect(takes).toHaveLength(historyFixture.takes)
    expect(natives).toHaveLength(historyFixture.natives)
    expect(
      new Set(takes.map(({ entry }) => `${entry.clipId}/${entry.lineId}`)).size,
    ).toBe(historyFixture.lines)
    expect(
      takes.filter(
        ({ entry }) =>
          entry.clipId === history.favourite.clipId &&
          entry.lineId === history.favourite.lineId,
      ),
    ).toHaveLength(historyFixture.takes / historyFixture.favouriteEvery)
    expect(history.daysPractised).toBe(242)
    expect(
      takes.filter(({ entry }) => entry.score._tag === 'Scored').length,
    ).toBe(takes.length)
  })

  test('is the same file, byte for byte, every time it is made', () => {
    const sha256 = (bytes: Uint8Array) =>
      createHash('sha256').update(bytes).digest('hex')
    expect(sha256(generatedBackup(generateHistory()))).toBe(sha256(backup))
    const json = unzipSync(backup)['history.json'] ?? new Uint8Array()
    expect(sha256(json)).toBe(pinnedSha256)
    expect(JSON.parse(strFromU8(json)).takes).toHaveLength(historyFixture.takes)
  })
})
