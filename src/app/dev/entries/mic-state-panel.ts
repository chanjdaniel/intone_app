import { Array, Option, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { takePanel } from '../../take/panel'
import { Take, TakeResult } from '../../take/take'
import { type DevEntry, buttonFocusClass, entryFrame } from '../entry'
import { sampleCurves } from '../sampleCurves'

// The mic state panel in every state a take can be in, each picked from
// the list, with the button it offers read out when pressed.

export const samples: ReadonlyArray<Readonly<{ name: string; take: Take }>> = [
  { name: 'Idle', take: Take.Idle() },
  {
    name: 'Playing the line',
    take: Take.PlayingNative({ takeNumber: 1, tracker: 'Loading' }),
  },
  { name: 'Preparing', take: Take.Preparing({ takeNumber: 1 }) },
  { name: 'Asking', take: Take.AwaitingMic({ takeNumber: 1 }) },
  { name: 'Prompt ignored', take: Take.MicPromptIgnored({ takeNumber: 1 }) },
  {
    name: 'Recording',
    take: Take.Recording({
      takeNumber: 1,
      elapsedSeconds: 2.6,
      levelDb: -14,
      maybeOnsetSeconds: Option.some(0.5),
    }),
  },
  { name: 'Analysing', take: Take.Analysing({ takeNumber: 1 }) },
  {
    name: 'Curve',
    take: Take.ShowingResult({
      takeNumber: 1,
      result: TakeResult.Tracked({ curve: sampleCurves.middle }),
    }),
  },
  {
    name: 'Listening',
    take: Take.Listening({
      voice: 'Line',
      maybeTake: Option.some({
        takeNumber: 1,
        result: TakeResult.Tracked({ curve: sampleCurves.middle }),
      }),
    }),
  },
  {
    name: 'Too quiet',
    take: Take.ShowingResult({
      takeNumber: 1,
      result: TakeResult.TooQuiet(),
    }),
  },
  {
    name: 'Too noisy',
    take: Take.ShowingResult({
      takeNumber: 1,
      result: TakeResult.TooNoisy(),
    }),
  },
  { name: 'Denied', take: Take.MicDenied() },
  { name: 'No device', take: Take.NoMicDevice() },
  {
    name: 'Microphone failed',
    take: Take.MicFailed({ reason: 'Could not start audio source' }),
  },
  {
    name: 'Tracking failed',
    take: Take.AnalysisFailed({
      reason: 'The pitch tracker did not start: The pitch model did not load.',
    }),
  },
]

// MODEL

export const Model = Schema.Struct({
  sample: Schema.String,
  maybePressed: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedSample: { name: Schema.String },
  ClickedRecord: {},
  ClickedStop: {},
  ClickedCancelTake: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { sample: 'Idle', maybePressed: Option.none() },
})

// UPDATE

const pressed = (model: Model, button: string) => ({
  model: modifyFields(model, { maybePressed: () => Option.some(button) }),
})

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedSample: ({ name }) => ({
      model: modifyFields(model, {
        sample: () => name,
        maybePressed: () => Option.none(),
      }),
    }),
    ClickedRecord: () => pressed(model, 'record'),
    ClickedStop: () => pressed(model, 'stop'),
    ClickedCancelTake: () => pressed(model, 'cancel'),
  })

// VIEW

const takeOf = (name: string): Take =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(samples, sample => sample.name === name),
      sample => sample.take,
    ),
    () => Take.Idle(),
  )

const pickerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.ul(
    [h.AriaLabel('States'), h.Class('flex flex-wrap gap-2')],
    Array.map(samples, ({ name }) =>
      h.keyed('li')(
        name,
        [],
        [
          h.button(
            [
              h.Type('button'),
              h.AriaPressed(model.sample === name ? 'true' : 'false'),
              h.OnClick(Message.SelectedSample({ name })),
              h.Class(
                `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm aria-pressed:border-accent aria-pressed:bg-raised aria-pressed:ring-1 aria-pressed:ring-accent ${buttonFocusClass}`,
              ),
            ],
            [name],
          ),
        ],
      ),
    ),
  )

export const readOut = (model: Model): string =>
  `${model.sample}: ${takeOf(model.sample)._tag}; ${Option.match(
    model.maybePressed,
    {
      onNone: () => 'no button pressed yet',
      onSome: button => `pressed ${button}`,
    },
  )}`

export const choices: ReadonlyArray<string> = [
  'The screen says the prompt is being ignored after 4 seconds. Would you rather it waited longer, or said so sooner?',
  'A take stops by itself at 30 seconds. Is that long enough for the longest line you would copy?',
  'Recording shows a pulsing red dot, the clock and the level meter; your curve draws above the panel as you speak. Is the clock useful, or noise?',
  'Pressing record plays the line once at its own speed, then opens the microphone. Should it play at the speed you chose for listening instead?',
  'A blocked microphone explains where Chrome keeps the setting. Should it name the steps for Safari and Firefox too?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Mic state panel',
      summary:
        'One clear screen for every state of a take, from the record button through playing the line to the result, each with one thing to do next.',
      demo: [
        pickerView(model, h),
        takePanel(
          takeOf(model.sample),
          {
            record: Message.ClickedRecord(),
            stop: Message.ClickedStop(),
            cancel: Message.ClickedCancelTake(),
          },
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
