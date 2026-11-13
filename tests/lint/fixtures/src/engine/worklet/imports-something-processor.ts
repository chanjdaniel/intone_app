// Refused: an audio worklet processor's module is loaded on its own, on the
// audio thread, so it imports nothing, not even the rest of the engine.
import { semitones } from '../../score/semitones' // lint: eslint(no-restricted-imports)
import { decodeWav } from '../audio/wav' // lint: eslint(no-restricted-imports)
import type { Wav } from '../audio/wav' // lint: eslint(no-restricted-imports)

export const used = [decodeWav, semitones]
export type Used = Wav
export const later = () => import('./ring') // lint: eslint(no-restricted-imports)
