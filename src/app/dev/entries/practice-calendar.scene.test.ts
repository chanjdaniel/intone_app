import { click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, expect as expectValue, test } from 'vitest'

import { sampleCounts, sampleEntries, sampleSummary } from '../sampleHistory'
import { init, readOut, update, view } from './practice-calendar'

describe('the practice calendar entry', () => {
  test('is drawn from the sample history, whose counts are pinned', () => {
    expectValue(sampleEntries).toHaveLength(sampleCounts.takes)
    expectValue(sampleSummary.lines).toHaveLength(sampleCounts.lines)
    expectValue(sampleSummary.days).toHaveLength(151)
    expectValue(readOut(init().model)).toBe(
      'November 2026: 5 days practised, 66 takes',
    )
  })

  test('steps back a month, and not past this one', () => {
    scene(
      { update, view },
      given(init().model),
      expect(role('button', { name: 'Show December 2026' })).toBeDisabled(),
      click(role('button', { name: 'Show October 2026' })),
      expect(text(/^Read-out: October 2026: \d+ days practised/)).toExist(),
      expect(role('button', { name: 'Show November 2026' })).toBeEnabled(),
    )
  })
})
