import { Schema } from 'effect'

import { ClipEntry } from '../../services/history-records'
import { type LevelClip, levelClipOf } from '../level/level'
import cutStudy from './cutStudyLines.json'

// The dev library's demo clip: the LibriVox CC0 clip the cut study cut
// (docs/cut-study.md), its lines as `npm run cut:study` wrote them, read
// through the history's own Schema and made into what the level screen
// shows by the app's own converter. Never edit the JSON by hand.

export const cutStudyClip: LevelClip = levelClipOf(
  Schema.decodeUnknownSync(ClipEntry)({
    format: 1,
    id: 'cut-study',
    name: `${cutStudy.clip}.wav`,
    addedAt: 0,
    seconds: cutStudy.seconds,
    audio: { file: 'clips/cut-study.wav', type: 'audio/wav', bytes: 1 },
    lines: cutStudy.lines.map((line, k) => ({
      id: String(k + 1),
      from: line.from,
      to: line.to,
      native:
        line.native === 'Tracked'
          ? { _tag: 'Tracked', nativeId: `cut-study-${k + 1}` }
          : { _tag: line.native },
    })),
  }),
)
