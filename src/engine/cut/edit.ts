// The learner's fixes to a clip's lines, on their spans: an edge moved,
// a line split at a point, two neighbours merged. Times are seconds from
// the clip's start, kept on the 16 kHz sample grid the lines were cut
// and are tracked on, so a span read back as samples is exact.

export type Span = Readonly<{ from: number; to: number }>

export type Edge = 'from' | 'to'

// No line is made shorter than this: under it there is barely a mora to
// copy (Silero's shortest speech, ../cut/lines.ts, is the same 250 ms).
export const shortestLineSeconds = 0.25

const gridRate = 16_000

export const onSampleGrid = (seconds: number): number =>
  Math.round(seconds * gridRate) / gridRate

// Two lines whose edges are under a sample apart share the edge: moving
// it moves both.
const touches = (earlier: Span | undefined, later: Span | undefined) =>
  earlier !== undefined &&
  later !== undefined &&
  Math.abs(later.from - earlier.to) < 0.5 / gridRate

// Where line `index`'s `edge` may go: never past its neighbour, never
// leaving it or a neighbour sharing the edge shorter than the shortest
// line, never outside the clip.
export const edgeLimits = (
  spans: ReadonlyArray<Span>,
  index: number,
  edge: Edge,
  clipSeconds: number,
): Readonly<{ least: number; most: number; shared: boolean }> => {
  const line = spans[index]
  if (line === undefined) {
    return { least: 0, most: 0, shared: false }
  }
  if (edge === 'to') {
    const after = spans[index + 1]
    const shared = touches(line, after)
    return {
      least: onSampleGrid(line.from + shortestLineSeconds),
      most:
        after === undefined
          ? clipSeconds
          : shared
            ? onSampleGrid(after.to - shortestLineSeconds)
            : after.from,
      shared,
    }
  }
  const before = spans[index - 1]
  const shared = touches(before, line)
  return {
    least:
      before === undefined
        ? 0
        : shared
          ? onSampleGrid(before.from + shortestLineSeconds)
          : before.to,
    most: onSampleGrid(line.to - shortestLineSeconds),
    shared,
  }
}

const clamp = (value: number, least: number, most: number): number =>
  Math.min(most, Math.max(least, value))

// The spans with line `index`'s `edge` moved as near `seconds` as its
// limits let it, and a neighbour sharing the edge moved with it.
export const movedEdge = (
  spans: ReadonlyArray<Span>,
  index: number,
  edge: Edge,
  seconds: number,
  clipSeconds: number,
): ReadonlyArray<Span> => {
  const { least, most, shared } = edgeLimits(spans, index, edge, clipSeconds)
  const at = clamp(onSampleGrid(seconds), least, most)
  return spans.map((span, k) => {
    if (k === index) {
      return edge === 'to'
        ? { from: span.from, to: at }
        : { from: at, to: span.to }
    }
    if (shared && edge === 'to' && k === index + 1) {
      return { from: at, to: span.to }
    }
    if (shared && edge === 'from' && k === index - 1) {
      return { from: span.from, to: at }
    }
    return span
  })
}

// Whether `span` can be split at `seconds`, leaving two lines each at
// least the shortest line long.
export const canSplit = (span: Span, seconds: number): boolean => {
  const at = onSampleGrid(seconds)
  return (
    at - span.from >= shortestLineSeconds - 0.5 / gridRate &&
    span.to - at >= shortestLineSeconds - 0.5 / gridRate
  )
}

export const splitSpans = (
  span: Span,
  seconds: number,
): readonly [Span, Span] => {
  const at = onSampleGrid(seconds)
  return [
    { from: span.from, to: at },
    { from: at, to: span.to },
  ]
}

// Two neighbours as one line, with the pause between them.
export const mergedSpan = (earlier: Span, later: Span): Span => ({
  from: earlier.from,
  to: later.to,
})
