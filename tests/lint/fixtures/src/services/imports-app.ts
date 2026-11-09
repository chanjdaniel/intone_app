import * as App from '../app' // lint: eslint(no-restricted-imports)
// Refused: nothing below src/app imports it.
import { Model } from '../app/main' // lint: eslint(no-restricted-imports)

export const used = [Model, App]
