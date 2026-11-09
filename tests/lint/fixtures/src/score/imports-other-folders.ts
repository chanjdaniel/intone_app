// Refused: src/score imports only itself.
import { view } from '../app/main' // lint: eslint(no-restricted-imports)
import { paint } from '../engine/draw/paint' // lint: eslint(no-restricted-imports)
import { Scorer } from '../services/scorer' // lint: eslint(no-restricted-imports)
import { program } from '../workers/clip' // lint: eslint(no-restricted-imports)
import { gate } from './constants'

export const used = [view, paint, Scorer, program, gate]
