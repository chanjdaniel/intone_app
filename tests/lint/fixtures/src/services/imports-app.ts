import * as App from '../app' // lint: eslint(no-restricted-imports)
import { Model } from '../app/main' // lint: eslint(no-restricted-imports)

// Refused: nothing below src/app imports it.
export const used = [Model, App]
