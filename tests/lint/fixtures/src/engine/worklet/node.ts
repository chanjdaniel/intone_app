// Allowed: the code that loads a worklet processor, beside it, imports like
// the rest of the engine.
import { decodeWav } from '../audio/wav'
import processorUrl from './imports-something-processor.ts?worker&url'

export const used = [processorUrl, decodeWav]
