// Refused: src/engine imports nothing from Foldkit, and nothing from src/app.
import { Mount } from 'foldkit' // lint: eslint(no-restricted-imports)

import { Button } from '@foldkit/ui' // lint: eslint(no-restricted-imports)

import { view } from '../../app/main' // lint: eslint(no-restricted-imports)

export const used = [Mount, Button, view]
