// Allowed: a service imports Effect, src/engine, src/score, its own
// subfolders and packages, even one whose path ends in `app`.
import { Context, Effect } from 'effect'
import { initializeApp } from 'firebase/app'

import { track } from '../engine/pitch/track'
import { match } from '../score/match'
import { config } from './app'
import { cache } from './app/cache'

export const used = [
  Context,
  Effect,
  initializeApp,
  track,
  match,
  config,
  cache,
]
