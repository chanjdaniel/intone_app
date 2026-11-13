import { provisionalClipTop, starBeatShare, starReachShare } from './constants'

// A line's stars, 0 to 3 (report section 5): one for a guided take that
// reaches the clip's threshold, two for one that beats it, three for a
// blind take that reaches it. A line keeps the most any of its takes
// earned, so a weaker take later costs nothing, and a take that could
// not be compared earns nothing and costs nothing. A match is read at
// the whole percent the app shows it as, so a take shown at the
// threshold has reached it.

export type Stars = 0 | 1 | 2 | 3

export type StarThresholds = Readonly<{ reach: number; beat: number }>

// The matches a take of a clip reaches and beats, as shares of the
// clip's top (./constants.ts, `provisionalClipTop`).
export const starThresholds = (
  clipTop: number = provisionalClipTop,
): StarThresholds => ({
  reach: starReachShare * clipTop,
  beat: starBeatShare * clipTop,
})

// What a take's stars need of it: how it was made, and its match when
// it was compared.
export type StarTake = Readonly<{
  mode: 'Guided' | 'Blind'
  score:
    | Readonly<{ _tag: 'Scored'; match: number }>
    | Readonly<{ _tag: 'CouldNotCompare' }>
}>

const percent = (share: number): number => Math.round(100 * share)

export const starsOfTake = (
  take: StarTake,
  thresholds: StarThresholds,
): Stars => {
  if (take.score._tag !== 'Scored') {
    return 0
  }
  const shown = percent(take.score.match)
  const reached = shown >= percent(thresholds.reach)
  if (take.mode === 'Blind') {
    return reached ? 3 : 0
  }
  return shown >= percent(thresholds.beat) ? 2 : reached ? 1 : 0
}

export const starsOf = (
  takes: ReadonlyArray<StarTake>,
  thresholds: StarThresholds,
): Stars =>
  takes.reduce<Stars>((most, take) => {
    const earned = starsOfTake(take, thresholds)
    return earned > most ? earned : most
  }, 0)
