import type { TakeEntry } from '../../services/history-records'

// Take entries as the history store gives them, for the history screens'
// own tests; nothing in the app imports them.

const day = (takenAt: number): string =>
  new Date(takenAt).toISOString().slice(0, 10)

export const entryOf = (
  overrides: Partial<TakeEntry> & Pick<TakeEntry, 'id' | 'takenAt'>,
): TakeEntry => ({
  format: 1,
  clipId: 'ame-ga-suki',
  lineId: '1',
  lineText: '雨が好き',
  mode: 'Guided',
  day: day(overrides.takenAt),
  nativeId: 'native-1',
  score: {
    _tag: 'Scored',
    version: 1,
    match: 0.5,
    parts: { pitchAccent: 0.5, timing: 0.5 },
    worstStretch: { nativeFrom: 0, nativeTo: 0.4, takeFrom: 0, takeTo: 0.4 },
    provisional: true,
  },
  audio: null,
  ...overrides,
})

export const scoredAt = (match: number, version = 1): TakeEntry['score'] => ({
  _tag: 'Scored',
  version,
  match,
  parts: { pitchAccent: match, timing: match },
  worstStretch: { nativeFrom: 0, nativeTo: 0.4, takeFrom: 0, takeTo: 0.4 },
  provisional: true,
})

export const couldNotCompare = (version = 1): TakeEntry['score'] => ({
  _tag: 'CouldNotCompare',
  version,
  reason: 'LengthMismatch',
})

export const dayMs = 86_400_000
// 9 November 2026, 10:00 UTC.
export const nov9 = Date.UTC(2026, 10, 9, 10)
