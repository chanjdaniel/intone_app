// Allowed: src/app imports Foldkit, Effect and every folder below it.
import { Schema } from 'effect'
import { Runtime } from 'foldkit'
import { html } from 'foldkit/html'

import { level } from '../engine/audio/level'
import { match } from '../score/match'
import { Tracker } from '../services/tracker'

export const used = [Schema, Runtime, html, level, match, Tracker]
