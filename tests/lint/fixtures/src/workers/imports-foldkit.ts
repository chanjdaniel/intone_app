import { Effect } from 'effect'
// Refused: only src/app imports Foldkit, and a Worker has no screen.
import { Runtime } from 'foldkit' // lint: eslint(no-restricted-imports)

export const used = [Runtime, Effect]
