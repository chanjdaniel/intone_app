import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { LineProgress } from '../level/progress'

// The open line's place in its level: the level's name, the line's stars
// and best so far (../level/progress.ts), and the next line to copy,
// read from the device each time the line opens, and moved on by each
// take kept while it is open.

const clipId = Schema.String
const lineId = Schema.String

// The next line of the level that can be copied, as its row names it.
export const NextLine = Schema.Struct({
  lineId,
  title: Schema.String,
  // Whether the title is Japanese text, read as such.
  titleIsText: Schema.Boolean,
})
export type NextLine = typeof NextLine.Type

export const LinePlace = defineTaggedUnion({
  NotLoaded: {},
  Loading: { clipId, lineId },
  Ready: {
    clipId,
    lineId,
    levelName: Schema.String,
    progress: LineProgress,
    maybeNext: Schema.Option(NextLine),
  },
  Failed: { clipId, lineId, reason: Schema.String },
})
export type LinePlace = typeof LinePlace.Type

export const isPlaceFor = (
  place: LinePlace,
  clip: string,
  line: string,
): boolean =>
  place._tag !== 'NotLoaded' && place.clipId === clip && place.lineId === line
