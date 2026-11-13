import { entry } from '../../app/dev/entries/tokens' // lint: eslint(no-restricted-imports)
// Refused: a static import of the dev library from deeper in src/app.
import { open } from '../dev/library' // lint: eslint(no-restricted-imports)

export const used = [open, entry]
