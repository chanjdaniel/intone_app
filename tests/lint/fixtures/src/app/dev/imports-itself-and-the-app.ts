// Allowed: the dev library's own files import each other and the app.
import { Runtime } from 'foldkit'

import { view } from '../main'
import { entry } from './entries/tokens'
import { frame } from './entry'

export const used = [Runtime, view, frame, entry]
