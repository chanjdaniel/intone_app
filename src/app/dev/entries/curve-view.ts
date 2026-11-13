import { Array, Effect, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  PairLearner,
  curvePairView,
  defineDrawCurvePair,
  describeCurve,
} from '../../take/curvePair'
import { type DevEntry, entryFrame } from '../entry'
import {
  type SampleTakeName,
  sampleLine,
  sampleTakeLabel,
  sampleTakeNames,
  sampleTakes,
} from '../samplePairs'

// A finished take over the line, as the practice screen shows it: the
// line's curve below, the take's above, coloured by closeness.

// MODEL

export const Model = Schema.Struct({ take: Schema.Literals(sampleTakeNames) })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedTake: { take: Schema.Literals(sampleTakeNames) },
  CompletedDrawCurvePair: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { take: 'low' },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedTake: ({ take }) => ({
      model: modifyFields(model, { take: () => take }),
    }),
    CompletedDrawCurvePair: () => ({ model }),
  })

// VIEW

export const DrawCurvePair = defineDrawCurvePair(
  Message.CompletedDrawCurvePair,
  () => Message.CompletedDrawCurvePair(),
  () => Effect.never,
)

export const readOut = (model: Model): string => {
  const take = describeCurve(sampleTakes[model.take])
  const line = describeCurve(sampleLine)
  return `${model.take}: the take ${take.seconds.toFixed(2)} s around ${Math.round(take.medianHz)} Hz, the line ${line.seconds.toFixed(2)} s around ${Math.round(line.medianHz)} Hz`
}

export const choices: ReadonlyArray<string> = [
  "Your curve is coloured from blue where it is within a semitone of the line to orange where it is 4 or more away, comparing each moment with the line's within about 150 ms either way. Is a semitone a step the right size?",
  "Each curve starts at its own voice onset and sits around its speaker's own typical pitch, so a low voice copying a high one draws the same shape. Would you rather see your real pitch against theirs?",
  'The width shows the line and a quarter more, and grows by half again when a take runs past it. Would you rather it always fitted the longer of the two exactly?',
  'Short pauses, up to about 150 ms, are bridged with dashes; longer ones are left empty. Is that the right length?',
  'Jitter is smoothed over 80 ms for drawing only. Does the line still look like your voice?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Curves: the line and a finished take',
      summary:
        "The line's curve as a grey band, and a finished take's drawn over it in semitones around each speaker's own median, from each voice's onset, coloured by how close it is.",
      demo: [
        h.ul(
          [h.AriaLabel('Takes'), h.Class('flex flex-wrap gap-2')],
          Array.map(sampleTakeNames, (take: SampleTakeName) =>
            h.keyed('li')(
              take,
              [],
              [
                h.button(
                  [
                    h.Type('button'),
                    h.AriaPressed(model.take === take ? 'true' : 'false'),
                    h.OnClick(Message.SelectedTake({ take })),
                    h.Class(
                      `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm aria-pressed:border-accent aria-pressed:bg-raised aria-pressed:ring-1 aria-pressed:ring-accent focus-ring`,
                    ),
                  ],
                  [sampleTakeLabel[take]],
                ),
              ],
            ),
          ),
        ),
        curvePairView(
          model.take,
          sampleLine,
          PairLearner.Finished({ curve: sampleTakes[model.take] }),
          "Each curve starts at its voice onset, around its speaker's own typical pitch; the lines are 3 semitones apart, and dashes bridge short pauses.",
          DrawCurvePair,
          h,
        ),
      ],
      readOut: readOut(model),
      choices,
    },
    h,
  )

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
