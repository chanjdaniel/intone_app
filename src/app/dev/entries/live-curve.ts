import { Array, Effect, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  defineDrawLiveCurve,
  describeLevel,
  levelMeter,
  liveCurveView,
} from '../../take/liveCurveView'
import { type DevEntry, buttonFocusClass, entryFrame } from '../entry'
import { replayLive } from '../liveReplay'
import { type SampleVoice, sampleCurves, sampleVoices } from '../sampleCurves'

// The learner's curve drawing live, each synthetic voice played back as
// the tracker finds it during a take, and the level meter at the levels
// it reads out.

// MODEL

export const Model = Schema.Struct({
  voice: Schema.Literals(sampleVoices),
  // Each playback is a take of its own, so a new one gets a new canvas.
  playback: Schema.Finite,
  finishedPlayback: Schema.Finite,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedVoice: { voice: Schema.Literals(sampleVoices) },
  ClickedPlayAgain: {},
  CompletedDrawLiveCurve: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { voice: 'middle', playback: 0, finishedPlayback: -1 },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedVoice: ({ voice }) => ({
      model: modifyFields(model, {
        voice: () => voice,
        playback: playback => playback + 1,
      }),
    }),
    ClickedPlayAgain: () => ({
      model: modifyFields(model, { playback: playback => playback + 1 }),
    }),
    CompletedDrawLiveCurve: () => ({
      model: modifyFields(model, {
        finishedPlayback: () => model.playback,
      }),
    }),
  })

// VIEW

// A playback's number names its voice too: the Mount's only arg.
const takeNumberOf = (voice: SampleVoice, playback: number): number =>
  playback * sampleVoices.length + sampleVoices.indexOf(voice)

const voiceOf = (takeNumber: number): SampleVoice =>
  sampleVoices[takeNumber % sampleVoices.length] ?? 'middle'

export const DrawLiveCurve = defineDrawLiveCurve(
  Message.CompletedDrawLiveCurve,
  () => Message.CompletedDrawLiveCurve(),
  takeNumber => Effect.succeed(replayLive(sampleCurves[voiceOf(takeNumber)])),
)

const voiceLabel: Readonly<Record<SampleVoice, string>> = {
  low: 'Low voice',
  middle: 'Middle voice',
  high: 'High voice',
}

export const meterSamples: ReadonlyArray<number> = [-60, -48, -20, -3]

export const readOut = (model: Model): string =>
  `${model.voice}, playback ${model.playback + 1}: ${
    model.finishedPlayback === model.playback
      ? 'finished, snapped to its median'
      : 'drawing'
  }`

export const choices: ReadonlyArray<string> = [
  'The curve runs about a quarter second behind your voice: SwiftF0 needs 160 ms of what follows each frame. Ticket 21 adds a faint fast tail if that feels too slow.',
  'The middle line follows your typical pitch so far, gliding to each new median over about half a second rather than jumping. Should it stay still until the take ends instead?',
  'The width shows at least 4 s from your onset, then squeezes to fit as you go on, and stretches to the whole width when the take ends. Would you rather it scrolled?',
  'The level meter shows the loudest sound in each tenth of a second, from silence at -60 dBFS to full scale. Screen readers can read it as silent, quiet, good or very loud, but it never announces itself. Is a meter useful while you speak?',
]

const pickerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-wrap gap-2')],
    [
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
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ClickedPlayAgain()),
          h.Class(
            `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm ${buttonFocusClass}`,
          ),
        ],
        ['Play again'],
      ),
    ],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Live curve and level meter',
      summary:
        "The learner's pitch drawn as the tracker finds it during a take, from the voice's onset, around a median that settles as the take goes on; and the meter that shows the microphone's level.",
      demo: [
        pickerView(model, h),
        liveCurveView(
          takeNumberOf(model.voice, model.playback),
          'From your voice onset. The middle line is your typical pitch so far; the lines are 3 semitones apart.',
          DrawLiveCurve,
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

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
