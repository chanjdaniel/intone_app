import { semitones } from '../../score/semitones'
import { Tracker } from '../../services/tracker' // lint: eslint(no-restricted-imports)
import { program } from '../../workers/tracker' // lint: eslint(no-restricted-imports)
import { resample } from './resample'

// Refused: src/engine imports only itself and src/score, never the folders
// that carry Effect.
export const used = [Tracker, program, resample, semitones]
