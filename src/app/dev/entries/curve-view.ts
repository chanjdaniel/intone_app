import { Array, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  curveView,
  definePaintCurve,
  describeCurve,
} from '../../take/curveView'
import { type DevEntry, buttonFocusClass, entryFrame } from '../entry'
import { type SampleVoice, sampleCurves, sampleVoices } from '../sampleCurves'

// The finished curve as a take shows it, for each synthetic voice: the
// same shape at three registers draws the same.

// MODEL

export const Model = Schema.Struct({ voice: Schema.Literals(sampleVoices) })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedVoice: { voice: Schema.Literals(sampleVoices) },
  CompletedPaintCurve: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { voice: 'middle' },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedVoice: ({ voice }) => ({
      model: modifyFields(model, { voice: () => voice }),
    }),
    CompletedPaintCurve: () => ({ model }),
  })

// VIEW

export const PaintCurve = definePaintCurve(Message.CompletedPaintCurve, () =>
  Message.CompletedPaintCurve(),
)

const voiceLabel: Readonly<Record<SampleVoice, string>> = {
  low: 'Low voice',
  middle: 'Middle voice',
  high: 'High voice',
}

export const readOut = (model: Model): string => {
  const { seconds, medianHz } = describeCurve(sampleCurves[model.voice])
  return `${model.voice}: ${seconds.toFixed(2)} s from the onset, median ${Math.round(medianHz)} Hz`
}

export const choices: ReadonlyArray<string> = [
  'The axis reaches 12 semitones either side of your typical pitch, the same for every take, so two takes compare at a glance. Would you rather it zoomed to each take?',
  'Every unvoiced frame breaks the line. Ticket 07 draws short gaps dashed and long ones empty; is that what you want here too?',
  'Lines every 3 semitones, labelled every 6. Too busy, or too sparse?',
  'The curve runs from your voice onset to your last voiced frame, stretched to the width. A fixed time scale would show long and short takes at their own lengths instead. Which do you want?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Curve view',
      summary:
        "A finished take's pitch, in semitones around the speaker's own median, from the voice's onset, with gaps where no voice was tracked.",
      demo: [
        h.ul(
          [h.AriaLabel('Voices'), h.Class('flex flex-wrap gap-2')],
          Array.map(sampleVoices, voice =>
            h.keyed('li')(
              voice,
              [],
              [
                h.button(
                  [
                    h.Type('button'),
                    h.AriaPressed(model.voice === voice ? 'true' : 'false'),
                    h.OnClick(Message.SelectedVoice({ voice })),
                    h.Class(
                      `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm aria-pressed:border-accent aria-pressed:bg-raised aria-pressed:ring-1 aria-pressed:ring-accent ${buttonFocusClass}`,
                    ),
                  ],
                  [voiceLabel[voice]],
                ),
              ],
            ),
          ),
        ),
        curveView(model.voice, sampleCurves[model.voice], PaintCurve, h),
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
