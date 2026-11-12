import { Array, Effect, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  PairLearner,
  curvePairView,
  defineDrawCurvePair,
} from '../../take/curvePair'
import { describeLevel, levelMeter } from '../../take/levelMeter'
import { type DevEntry, entryFrame } from '../entry'
import { replayLive } from '../liveReplay'
import {
  type SampleTakeName,
  sampleLine,
  sampleTakeLabel,
  sampleTakeNames,
  sampleTakes,
} from '../samplePairs'

// A take drawing live over the line, each sample take played back as the
// tracker finds it during a take, and the level meter at the levels it
// reads out.

// MODEL

export const Model = Schema.Struct({
  take: Schema.Literals(sampleTakeNames),
  // Each playback is a take of its own, so a new one gets a new canvas.
  playback: Schema.Finite,
  finishedPlayback: Schema.Finite,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedTake: { take: Schema.Literals(sampleTakeNames) },
  ClickedPlayAgain: {},
  CompletedDrawCurvePair: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { take: 'low', playback: 0, finishedPlayback: -1 },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedTake: ({ take }) => ({
      model: modifyFields(model, {
        take: () => take,
        playback: playback => playback + 1,
      }),
    }),
    ClickedPlayAgain: () => ({
      model: modifyFields(model, { playback: playback => playback + 1 }),
    }),
    CompletedDrawCurvePair: () => ({
      model: modifyFields(model, {
        finishedPlayback: () => model.playback,
      }),
    }),
  })

// VIEW

// A playback's number names its take too: the Mount's only way to it.
const takeNumberOf = (take: SampleTakeName, playback: number): number =>
  playback * sampleTakeNames.length + sampleTakeNames.indexOf(take)

const takeOf = (takeNumber: number): SampleTakeName =>
  sampleTakeNames[takeNumber % sampleTakeNames.length] ?? 'low'

export const DrawCurvePair = defineDrawCurvePair(
  Message.CompletedDrawCurvePair,
  () => Message.CompletedDrawCurvePair(),
  takeNumber => Effect.succeed(replayLive(sampleTakes[takeOf(takeNumber)])),
)

export const meterSamples: ReadonlyArray<number> = [-60, -48, -20, -3]

export const readOut = (model: Model): string =>
  `${model.take}, playback ${model.playback + 1}: ${
    model.finishedPlayback === model.playback
      ? 'finished, snapped to its median'
      : 'drawing'
  }`

export const choices: ReadonlyArray<string> = [
  'The curve runs about a quarter second behind your voice: SwiftF0 needs 160 ms of what follows each frame. Ticket 21 adds a faint fast tail if that feels too slow.',
  "While you speak, each moment of your curve is coloured by how close it is to the line's within about 150 ms either way, with no number. Would a number help, or distract?",
  'The middle line follows your typical pitch so far, gliding to each new median over about half a second rather than jumping, so the colours settle as you go. Should it stay still until the take ends instead?',
  'The level meter shows the loudest sound in each tenth of a second, from silence at -60 dBFS to full scale. Screen readers can read it as silent, quiet, good or very loud, but it never announces itself. Is a meter useful while you speak?',
]

const pickerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-wrap gap-2')],
    [
      h.ul(
        [h.AriaLabel('Takes'), h.Class('flex flex-wrap gap-2')],
        Array.map(sampleTakeNames, take =>
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
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ClickedPlayAgain()),
          h.Class(
            `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm focus-ring`,
          ),
        ],
        ['Play again'],
      ),
    ],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const takeNumber = takeNumberOf(model.take, model.playback)
  return entryFrame(
    {
      title: 'Live curve over the line, and level meter',
      summary:
        "A take drawn over the line as the tracker finds it, from the voice's onset, around a median that settles as the take goes on, coloured by closeness; and the meter that shows the microphone's level.",
      demo: [
        pickerView(model, h),
        curvePairView(
          `live-${takeNumber}`,
          sampleLine,
          PairLearner.Live({ takeNumber }),
          "Your curve, as you speak. Each curve starts at its voice onset, around its speaker's own typical pitch; the lines are 3 semitones apart, and dashes bridge short pauses.",
          DrawCurvePair,
          h,
        ),
        h.ul(
          [h.AriaLabel('Meter levels'), h.Class('flex flex-col gap-3')],
          Array.map(meterSamples, levelDb =>
            h.keyed('li')(
              String(levelDb),
              [h.Class('flex flex-col gap-1')],
              [
                h.p(
                  [h.Class('text-sm text-muted')],
                  [`${levelDb} dBFS, read as ${describeLevel(levelDb)}`],
                ),
                levelMeter(levelDb, h),
              ],
            ),
          ),
        ),
      ],
      readOut: readOut(model),
      choices,
    },
    h,
  )
}

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
