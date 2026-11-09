// VOICEVOX's AudioQuery, as its Python binding serialises it, and the
// timeline it gives each mora. The timeline follows VOICEVOX CORE 0.17.1's
// own arithmetic (crates/voicevox_core/src/engine/talk/interpret_query.rs):
// each phoneme's length becomes a whole number of 93.75 Hz frames,
// rounded half to even in 32-bit floats, and every frame is 256 samples
// at 24 kHz, so a mora's boundaries fall on exact samples of the file.

export type QueryMora = Readonly<{
  text: string
  consonant: string | null
  consonant_length: number | null
  // A capital vowel (A, I, U, E, O) is devoiced; `N`, `cl` and `pau` are
  // the moraic nasal, the geminate closure and a pause.
  vowel: string
  vowel_length: number
  // The mora's log F0 (natural log of Hz), 0 when it has no voice.
  pitch: number
}>

export type QueryAccentPhrase = Readonly<{
  moras: ReadonlyArray<QueryMora>
  // The last high mora, counted from 1; equal to the mora count when the
  // phrase does not fall inside itself (heiban, or odaka without a
  // particle after it).
  accent: number
  pause_mora: QueryMora | null
  is_interrogative: boolean
}>

export type AudioQuery = Readonly<{
  accent_phrases: ReadonlyArray<QueryAccentPhrase>
  speed_scale: number
  pitch_scale: number
  intonation_scale: number
  volume_scale: number
  pre_phoneme_length: number
  post_phoneme_length: number
  output_sampling_rate: number
  output_stereo: boolean
}>

export const frameRate = 93.75
export const voicevoxSampleRate = 24000
export const samplesPerFrame = voicevoxSampleRate / frameRate

const f32 = Math.fround

const roundHalfToEven = (x: number): number => {
  const floor = Math.floor(x)
  const fraction = x - floor
  if (fraction > 0.5) return floor + 1
  if (fraction < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

// A length in seconds as frames, as VOICEVOX CORE's `to_frame_length`.
export const toFrameLength = (seconds: number, speedScale: number): number =>
  roundHalfToEven(
    f32(roundHalfToEven(f32(f32(seconds) * f32(frameRate))) / f32(speedScale)),
  )

export type TimedMora = Readonly<{
  text: string
  // Which accent phrase it belongs to, and its place there from 0.
  phrase: number
  index: number
  consonant: string | null
  vowel: string
  devoiced: boolean
  // In frames from the file's first sample: the mora's start, where its
  // vowel starts, and its end.
  startFrame: number
  vowelFrame: number
  endFrame: number
  // The pitch the synthesiser is given for the mora's frames, in Hz, after
  // the query's pitch and intonation scales, or null when it has no voice.
  pitchHz: number | null
}>

export type TimedPause = Readonly<{
  afterPhrase: number
  startFrame: number
  endFrame: number
}>

export type QueryTimeline = Readonly<{
  frames: number
  // Where the first mora starts and the last ends, in frames.
  speechFrom: number
  speechTo: number
  morae: ReadonlyArray<TimedMora>
  pauses: ReadonlyArray<TimedPause>
}>

const isDevoiced = (vowel: string): boolean => /^[AIUEO]$/.test(vowel)

export const timelineOf = (query: AudioQuery): QueryTimeline => {
  if (query.accent_phrases.some(phrase => phrase.is_interrogative)) {
    throw new Error(
      'A question lengthens its last mora; the timeline does not follow it.',
    )
  }
  const speed = query.speed_scale

  // The decoder's F0 per mora: log F0 times 2 ** pitch_scale, then the
  // voiced ones spread around their mean by intonation_scale.
  const allMorae = query.accent_phrases.flatMap(phrase => [
    ...phrase.moras,
    ...(phrase.pause_mora === null ? [] : [phrase.pause_mora]),
  ])
  const scaled = allMorae.map(mora =>
    f32(f32(mora.pitch) * f32(2 ** query.pitch_scale)),
  )
  let sum = 0
  let count = 0
  for (const f0 of scaled) {
    if (f0 > 0) {
      sum = f32(sum + f0)
      count++
    }
  }
  const mean = count === 0 ? Number.NaN : f32(sum / count)
  const intonation = f32(query.intonation_scale)
  const decoderF0 = scaled.map(f0 =>
    f0 > 0 && !Number.isNaN(mean)
      ? f32(f32(f32(f0 - mean) * intonation) + mean)
      : f0,
  )

  let frame = toFrameLength(query.pre_phoneme_length, speed)
  const speechFrom = frame
  const morae: Array<TimedMora> = []
  const pauses: Array<TimedPause> = []
  let flat = 0
  query.accent_phrases.forEach((phrase, phraseIndex) => {
    phrase.moras.forEach((mora, index) => {
      const startFrame = frame
      if (mora.consonant_length !== null) {
        frame += toFrameLength(mora.consonant_length, speed)
      }
      const vowelFrame = frame
      frame += toFrameLength(mora.vowel_length, speed)
      const f0 = decoderF0[flat] ?? 0
      flat++
      morae.push({
        text: mora.text,
        phrase: phraseIndex,
        index,
        consonant: mora.consonant,
        vowel: mora.vowel,
        devoiced: isDevoiced(mora.vowel),
        startFrame,
        vowelFrame,
        endFrame: frame,
        pitchHz: f0 > 0 ? Math.exp(f0) : null,
      })
    })
    if (phrase.pause_mora !== null) {
      const startFrame = frame
      if (phrase.pause_mora.consonant_length !== null) {
        frame += toFrameLength(phrase.pause_mora.consonant_length, speed)
      }
      frame += toFrameLength(phrase.pause_mora.vowel_length, speed)
      flat++
      pauses.push({ afterPhrase: phraseIndex, startFrame, endFrame: frame })
    }
  })
  const speechTo = frame
  frame += toFrameLength(query.post_phoneme_length, speed)
  return { frames: frame, speechFrom, speechTo, morae, pauses }
}
