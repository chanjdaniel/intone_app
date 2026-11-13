// From Silero VAD's speech probabilities to the lines of a clip: stretches
// of speech cut at pauses of about 300 ms, each about 1 to 4 s long, with
// a little of the quiet around them so no onset or last mora is clipped.
// The rules follow Silero VAD's own `get_speech_timestamps` (v6.2.3,
// `src/silero_vad/utils_vad.py`, the model in models.json): a stretch
// starts where the probability reaches the threshold and ends once it
// has stayed under a lower one for the pause; a stretch too long is cut
// at its longest inner silence. Two rules are this app's: a stretch too
// short to copy joins its neighbour across a short pause, and each line
// takes its share of the pause either side.

export type CutRules = Readonly<{
  // A window at or over this is speech...
  threshold: number
  // ...and speech ends only under this, as Silero's default (0.15 less).
  negativeThreshold: number
  // Speech ends after this much under the lower threshold: the pause
  // that cuts one line from the next (report section 2, 300 ms).
  pauseSeconds: number
  // Speech shorter than this is a click or a breath, and is left out
  // (Silero's default, 250 ms).
  shortestSpeechSeconds: number
  // A line longer than this is cut at its longest inner silence...
  longestLineSeconds: number
  // ...of at least this long (Silero's `min_silence_at_max_speech`).
  shortestInnerSilenceSeconds: number
  // A line shorter than this joins the nearer neighbour...
  shortestLineSeconds: number
  // ...when the pause between them is under this, and the two together
  // are no longer than the longest line.
  joinPauseSeconds: number
  // The quiet kept before and after each line, or half the pause to its
  // neighbour when that is less.
  leadSeconds: number
  tailSeconds: number
}>

export const cutRules: CutRules = {
  threshold: 0.5,
  negativeThreshold: 0.35,
  pauseSeconds: 0.3,
  shortestSpeechSeconds: 0.25,
  longestLineSeconds: 4,
  shortestInnerSilenceSeconds: 0.098,
  shortestLineSeconds: 1,
  joinPauseSeconds: 0.8,
  leadSeconds: 0.15,
  tailSeconds: 0.2,
}

// A line, in samples of the 16 kHz audio the probabilities were found in:
// from its first sample, up to but not including `to`.
export type CutLine = Readonly<{ from: number; to: number }>

type Silence = Readonly<{ from: number; to: number }>

type Speech = Readonly<{
  from: number
  to: number
  // The silences inside it, each under the pause.
  silences: ReadonlyArray<Silence>
}>

// The stretches of speech, with the short silences inside each.
const speechOf = (
  probabilities: ArrayLike<number>,
  window: number,
  sampleCount: number,
  rules: CutRules,
): Array<Speech> => {
  const pause = rules.pauseSeconds * 16_000
  const speeches: Array<Speech> = []
  let start = -1
  let silenceFrom = -1
  let silences: Array<Silence> = []
  const end = (to: number): void => {
    speeches.push({ from: start, to, silences })
    start = -1
    silenceFrom = -1
    silences = []
  }
  for (let k = 0; k < probabilities.length; k += 1) {
    const probability = probabilities[k] ?? 0
    const at = k * window
    if (start < 0) {
      if (probability >= rules.threshold) {
        start = at
      }
      continue
    }
    if (probability >= rules.threshold && silenceFrom >= 0) {
      silences.push({ from: silenceFrom, to: at })
      silenceFrom = -1
    }
    if (probability < rules.negativeThreshold) {
      if (silenceFrom < 0) {
        silenceFrom = at
      }
      if (at - silenceFrom >= pause) {
        end(silenceFrom)
      }
    }
  }
  if (start >= 0) {
    end(silenceFrom >= 0 ? silenceFrom : sampleCount)
  }
  return speeches
}

// Cuts a stretch longer than the longest line at its longest inner
// silence, again and again, or in the middle when it has none.
const split = (speech: Speech, rules: CutRules): Array<Speech> => {
  const longest = rules.longestLineSeconds * 16_000
  if (speech.to - speech.from <= longest) {
    return [speech]
  }
  const shortest = rules.shortestInnerSilenceSeconds * 16_000
  const silence = speech.silences
    .filter(inner => inner.to - inner.from >= shortest)
    .reduce<Silence | null>(
      (best, inner) =>
        best === null || inner.to - inner.from > best.to - best.from
          ? inner
          : best,
      null,
    )
  const cut = silence ?? {
    from: Math.round((speech.from + speech.to) / 2),
    to: Math.round((speech.from + speech.to) / 2),
  }
  return [
    ...split(
      {
        from: speech.from,
        to: cut.from,
        silences: speech.silences.filter(inner => inner.to <= cut.from),
      },
      rules,
    ),
    ...split(
      {
        from: cut.to,
        to: speech.to,
        silences: speech.silences.filter(inner => inner.from >= cut.to),
      },
      rules,
    ),
  ]
}

// Joins each line shorter than the shortest to the neighbour across the
// shorter pause, while the pause is short and the join not too long.
const join = (
  lines: ReadonlyArray<CutLine>,
  rules: CutRules,
): Array<CutLine> => {
  const shortest = rules.shortestLineSeconds * 16_000
  const longest = rules.longestLineSeconds * 16_000
  const joinPause = rules.joinPauseSeconds * 16_000
  const joined = [...lines]
  let k = 0
  while (k < joined.length) {
    const line = joined[k]
    if (line === undefined || line.to - line.from >= shortest) {
      k += 1
      continue
    }
    const before = joined[k - 1]
    const after = joined[k + 1]
    const fits = (other: CutLine | undefined, pause: number) =>
      other !== undefined &&
      pause < joinPause &&
      Math.max(line.to, other.to) - Math.min(line.from, other.from) <= longest
    const pauseBefore = before === undefined ? Infinity : line.from - before.to
    const pauseAfter = after === undefined ? Infinity : after.from - line.to
    const intoBefore = fits(before, pauseBefore)
    const intoAfter = fits(after, pauseAfter)
    if (
      intoBefore &&
      before !== undefined &&
      (!intoAfter || pauseBefore <= pauseAfter)
    ) {
      joined.splice(k - 1, 2, { from: before.from, to: line.to })
      k -= 1
    } else if (intoAfter && after !== undefined) {
      joined.splice(k, 2, { from: line.from, to: after.to })
    } else {
      k += 1
    }
  }
  return joined
}

// Gives each line its lead and tail, or half the pause to its neighbour.
const pad = (
  lines: ReadonlyArray<CutLine>,
  sampleCount: number,
  rules: CutRules,
): Array<CutLine> => {
  const lead = Math.round(rules.leadSeconds * 16_000)
  const tail = Math.round(rules.tailSeconds * 16_000)
  return lines.map((line, k) => {
    const before = lines[k - 1]
    const after = lines[k + 1]
    const from =
      before === undefined
        ? Math.max(0, line.from - lead)
        : Math.max(line.from - lead, Math.ceil((before.to + line.from) / 2))
    const to =
      after === undefined
        ? Math.min(sampleCount, line.to + tail)
        : Math.min(line.to + tail, Math.floor((line.to + after.from) / 2))
    return { from, to }
  })
}

// The lines of 16 kHz audio of `sampleCount` samples whose speech
// probability is `probabilities[k]` for the samples from `k * window`.
export const cutLines = (
  probabilities: ArrayLike<number>,
  window: number,
  sampleCount: number,
  rules: CutRules = cutRules,
): ReadonlyArray<CutLine> => {
  const shortestSpeech = rules.shortestSpeechSeconds * 16_000
  const speeches = speechOf(probabilities, window, sampleCount, rules).filter(
    speech => speech.to - speech.from >= shortestSpeech,
  )
  const lines = speeches
    .flatMap(speech => split(speech, rules))
    .map(({ from, to }) => ({ from, to }))
  return pad(join(lines, rules), sampleCount, rules)
}
