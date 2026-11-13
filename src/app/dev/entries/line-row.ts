import { Array, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'

import { linePath, lineRow } from '../../line/lineRow'
import { firstLines } from '../../line/lines'
import { type DevEntry, entryFrame } from '../entry'

// The home screen's row for each bundled line.

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

export const readOut = (): string =>
  Array.map(firstLines, line => `${line.text} links to ${linePath(line)}`).join(
    '; ',
  )

export const choices: ReadonlyArray<string> = [
  "Each row shows the line, its reading and its voice's credit, and the whole row opens the line. Should it also show the accent pattern, as the 2023 slides grouped lines by it?",
  'The credit is the one VOICEVOX asks for, and /credits names it too. Is it in the right place on the row?',
]

export const view = (_model: Model, h: HtmlBuilder<never>): Html =>
  entryFrame(
    {
      title: 'Line row',
      summary: 'One line to copy, as the home screen lists it.',
      demo: [
        h.ul(
          [h.Class('flex flex-col gap-3')],
          Array.map(firstLines, line =>
            h.keyed('li')(
              `${line.clipId}/${line.lineId}`,
              [],
              [lineRow(line, h)],
            ),
          ),
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
