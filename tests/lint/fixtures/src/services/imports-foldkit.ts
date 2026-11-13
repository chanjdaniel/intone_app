// Refused: only src/app imports Foldkit.
import { Runtime } from 'foldkit' // lint: eslint(no-restricted-imports)
import { html } from 'foldkit/html' // lint: eslint(no-restricted-imports)

import { Button } from '@foldkit/ui' // lint: eslint(no-restricted-imports)

export const used = [Runtime, html, Button]
