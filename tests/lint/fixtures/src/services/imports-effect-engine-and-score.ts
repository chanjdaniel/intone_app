// Allowed: a service imports Effect, src/engine and src/score.
import { Context, Effect } from 'effect'

import { track } from '../engine/pitch/track'
import { match } from '../score/match'

export const used = [Context, Effect, track, match]
