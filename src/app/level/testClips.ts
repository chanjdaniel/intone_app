import { Option } from 'effect'

import type { LevelClip, LevelLine } from './level'

// A clip as the Model knows it, with `count` lines of about 2.5 s each,
// for the app's own tests; nothing in the app imports it.
export const sampleClip = (count: number, hasAudio = true): LevelClip => ({
  id: 'c1',
  name: 'reading.mp3',
  seconds: count * 3 + 1,
  addedAt: 1_000,
  hasAudio,
  lines: Array.from({ length: count }, (_, k): LevelLine => ({
    id: String(k + 1),
    number: k + 1,
    from: k * 3 + 0.4,
    to: k * 3 + 2.9,
    native: k === 1 ? 'TooQuiet' : 'Tracked',
    maybeQuality:
      k === 1
        ? Option.none()
        : Option.some({
            speechFrames: 120,
            confidentShare: 0.68,
            pauseFrames: 18,
            pausePitchedShare: 0,
          }),
  })),
  maybeUndo: Option.none(),
})
