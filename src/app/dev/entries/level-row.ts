import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'

import { LevelStars, levelClipOfBundled } from '../../level/level'
import { levelRow, starsOfLine } from '../../level/levelView'
import { bundledClips } from '../../line/lines'
import { lineRouter } from '../../route'
import { type DevEntry, entryFrame } from '../entry'
import { cutStudyClip } from '../sampleClips'
import { sampleLevelStars } from '../sampleStars'

// A level's rows: each line with its stars, the whole row a link to its
// practice screen; the bundled line's, and the cut study's clip with
// stars made from seeded takes (../sampleStars.ts) by the app's own
// rules. A line that cannot be copied keeps its place, its stars beside
// it, with no link.

const bundled = levelClipOfBundled(bundledClips[0]!)
const studyStars = LevelStars.Ready({ lines: sampleLevelStars })

// MODEL

export const Model = Schema.Struct({})
export type Model = typeof Model.Type

// INIT

export const init: Runtime.ElementInit<Model, never> = () => ({ model: {} })

// UPDATE

export const update = (model: Model): Update.Return<Model, never> => ({
  model,
})

// VIEW

const shownLines = cutStudyClip.lines.slice(0, 8)

export const readOut = (): string =>
  shownLines
    .map(
      line =>
        `Line ${line.number}: ${starsOfLine(studyStars, line.id) ?? 0} stars${line.native === 'Tracked' ? `, links to ${lineRouter({ clipId: cutStudyClip.id, lineId: line.id })}` : ''}`,
    )
    .join('; ')

export const choices: ReadonlyArray<string> = [
  'Each row shows its stars above Copy, at the right. On a phone they sit beside the line’s name; should they move under it instead?',
  'A line with no take shows three empty stars. Would you rather it showed none until its first take?',
  'The rows keep the large list’s frame, a find field past 12 rows and 50 at a time. Should a level also offer “the next line without three stars”?',
]

const list = <ViewMessage>(
  rows: ReadonlyArray<Html>,
  h: HtmlBuilder<ViewMessage>,
): Html => h.ul([h.Class('flex flex-col gap-2')], rows)

export const view = (_model: Model, h: HtmlBuilder<never>): Html =>
  entryFrame(
    {
      title: 'Level row',
      summary:
        'A line on its level, with its stars: the bundled line, and lines of an upload with stars from seeded takes.',
      demo: [
        h.h3(
          [h.Class('text-lg font-bold')],
          ['The bundled line, before a take'],
        ),
        list(
          bundled.lines.map((line, index) =>
            levelRow(bundled.id, true, line, 0, index, null, h),
          ),
          h,
        ),
        h.h3(
          [h.Class('text-lg font-bold')],
          ['An upload, its lines practised'],
        ),
        list(
          shownLines.map((line, index) =>
            levelRow(
              cutStudyClip.id,
              true,
              line,
              starsOfLine(studyStars, line.id),
              index,
              null,
              h,
            ),
          ),
          h,
        ),
      ],
      readOut: readOut(),
      choices,
    },
    h,
  )

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
