// Refused: src/score is plain maths on typed arrays, with no Effect or
// Foldkit.
import { Schema } from 'effect' // lint: eslint(no-restricted-imports)
import * as Option from 'effect/Option' // lint: eslint(no-restricted-imports)
import { Runtime } from 'foldkit' // lint: eslint(no-restricted-imports)

export const used = [Schema, Option, Runtime]
