// The windows of an uploaded clip that Whisper reads, one after another:
// its encoder always reads 30 s, so a window is at most that long, and
// each closes in a pause between two lines, never inside one, so a word
// is never cut in two between windows. They run from just before the
// clip's first line to just after its last, so a long silence before or
// after the speech, where Whisper makes up words, is left out. A line
// longer than a window is cut into whole windows.

export type Span = Readonly<{ from: number; to: number }>

// Whisper's input: 30 s of audio, padded when shorter.
export const longestWindowSeconds = 30

// How far past a line's edges a window reaches, so a soft first or last
// sound is still heard.
export const windowMarginSeconds = 0.2

const rounded = (seconds: number): number => Math.round(seconds * 1000) / 1000

export const textWindows = (
  lines: ReadonlyArray<Span>,
  clipSeconds: number,
): ReadonlyArray<Span> => {
  const sorted = [...lines].sort((a, b) => a.from - b.from)
  const first = sorted[0]
  if (first === undefined) {
    return []
  }
  const windows: Array<Span> = []
  const reach = {
    start: rounded(Math.max(0, first.from - windowMarginSeconds)),
    end: 0,
  }
  const close = (to: number): void => {
    windows.push({ from: reach.start, to })
    reach.start = to
  }
  sorted.forEach((line, k) => {
    const end = rounded(Math.min(clipSeconds, line.to + windowMarginSeconds))
    const before = sorted[k - 1]
    if (end - reach.start > longestWindowSeconds && before !== undefined) {
      close(
        rounded(
          Math.min(
            reach.start + longestWindowSeconds,
            Math.max(reach.start, (before.to + line.from) / 2),
          ),
        ),
      )
    }
    while (end - reach.start > longestWindowSeconds) {
      close(rounded(reach.start + longestWindowSeconds))
    }
    reach.end = Math.max(reach.end, end)
  })
  close(reach.end)
  return windows
}
