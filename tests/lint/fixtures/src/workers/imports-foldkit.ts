import { Effect } from 'effect'
import { Runtime } from 'foldkit' // lint: eslint(no-restricted-imports)

// Refused: only src/app imports Foldkit, and a Worker has no screen.
export const used = [Runtime, Effect]
