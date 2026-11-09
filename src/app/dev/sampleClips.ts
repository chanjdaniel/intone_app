import { Schema } from 'effect'

import { ClipEntry } from '../../services/history-records'
import { type LevelClip, levelClipOf } from '../level/level'
import cutStudy from './cutStudyLines.json'

// The dev library's demo clip: the LibriVox CC0 clip the cut study cut
// (docs/cut-study.md), its waveform and lines as `npm run cut:study`
// wrote them, read through the history's own Schema and made into what
// the level screen shows by the app's own converter; and the same clip
// over the study's music bed, whose lines carry the marks. Never edit the
// JSON by hand.

type StudyLine = (typeof cutStudy.musicLines)[number]

const clipOf = (
  id: string,
  name: string,
  lines: ReadonlyArray<StudyLine>,
): LevelClip =>
  levelClipOf(
    Schema.decodeUnknownSync(ClipEntry)({
      format: 1,
      id,
      name,
      addedAt: 0,
      seconds: cutStudy.seconds,
      audio: { file: `clips/${id}.wav`, type: 'audio/wav', bytes: 1 },
      lines: lines.map((line, k) => ({
        id: String(k + 1),
        from: line.from,
        to: line.to,
        native:
          line.native === 'Tracked'
            ? { _tag: 'Tracked', nativeId: `${id}-${k + 1}` }
            : { _tag: line.native },
        ...('quality' in line ? { quality: line.quality } : {}),
      })),
    }),
  )

export const cutStudyClip: LevelClip = clipOf(
  'cut-study',
  `${cutStudy.clip}.wav`,
  cutStudy.lines,
)

export const musicStudyClip: LevelClip = clipOf(
  'cut-study-music',
  `${cutStudy.clip}, over the music bed.wav`,
  cutStudy.musicLines,
)

// The clip's waveform, a byte per 10 ms (src/engine/audio/peaks.ts).
export const cutStudyPeaks: Uint8Array = Uint8Array.from(
  atob(cutStudy.peaks),
  character => character.charCodeAt(0),
)
