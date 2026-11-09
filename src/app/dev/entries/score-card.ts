import { Array, Effect, Option, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { learnerOf } from '../../line/practiceView'
import { curvePairView, defineDrawCurvePair } from '../../take/curvePair'
import { takePanel } from '../../take/panel'
import { matchText, partsOf } from '../../take/scoreCard'
import { Extent, Take, Voice } from '../../take/take'
import { type DevEntry, buttonFocusClass, entryFrame } from '../entry'
import {
  type SampleScoreName,
  sampleNative,
  sampleScoreNames,
  sampleScores,
} from '../sampleScores'

// The score card after a take, in each state it can show: a scored take
// with its scale settled or still provisional, a take that missed the
// accent, and each reason a take could not be compared. The curves above
// it are lined up as the result draws them, with the worst stretch
// shaded, and its play buttons say what they would play.

// MODEL

const SampleName = Schema.Literals(sampleScoreNames)

export const Model = Schema.Struct({
  sample: SampleName,
  // The voice and extent asked for, while it would play.
  maybeListening: Schema.Option(
    Schema.Struct({ voice: Voice, extent: Extent }),
  ),
  maybePressed: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedSample: { sample: SampleName },
  ClickedRecord: {},
  ClickedListen: { voice: Voice, extent: Extent },
  ClickedStopListening: {},
  CompletedDrawCurvePair: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    sample: 'Provisional',
    maybeListening: Option.none(),
    maybePressed: Option.none(),
  },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedSample: ({ sample }) => ({
      model: modifyFields(model, {
        sample: () => sample,
        maybeListening: () => Option.none(),
        maybePressed: () => Option.none(),
      }),
    }),
    ClickedRecord: () => ({
      model: modifyFields(model, {
        maybePressed: () => Option.some('record again'),
      }),
    }),
    ClickedListen: ({ voice, extent }) => ({
      model: modifyFields(model, {
        maybeListening: () => Option.some({ voice, extent }),
        maybePressed: () =>
          Option.some(
            `hear ${voice === 'Line' ? 'the line' : 'your take'}${extent === 'WorstStretch' ? ' there' : ''}`,
          ),
      }),
    }),
    ClickedStopListening: () => ({
      model: modifyFields(model, {
        maybeListening: () => Option.none(),
        maybePressed: () => Option.some('stop'),
      }),
    }),
    CompletedDrawCurvePair: () => ({ model }),
  })

// VIEW

export const DrawCurvePair = defineDrawCurvePair(
  Message.CompletedDrawCurvePair,
  () => Message.CompletedDrawCurvePair(),
  () => Effect.never,
)

const takeOf = (model: Model): Take =>
  Option.match(model.maybeListening, {
    onNone: () => Take.ShowingResult(sampleScores[model.sample]),
    onSome: ({ voice, extent }) =>
      Take.Listening({
        voice,
        extent,
        maybeTake: Option.some(sampleScores[model.sample]),
      }),
  })

export const readOut = (model: Model): string => {
  const result = sampleScores[model.sample].result
  const said =
    result._tag !== 'Tracked'
      ? result._tag
      : result.score._tag === 'CouldNotCompare'
        ? `could not compare: ${result.score.reason}`
        : `${matchText(result.score)} (${Array.map(
            partsOf(result.score),
            ({ name, share }) => `${name} ${share.toFixed(3)}`,
          ).join(', ')})${result.score.provisional ? ', provisional' : ''}`
  return `${model.sample}: ${said}; ${Option.match(model.maybePressed, {
    onNone: () => 'no button pressed yet',
    onSome: pressed => `pressed ${pressed}`,
  })}`
}

export const choices: ReadonlyArray<string> = [
  'The headline is the parts weighted 0.6 pitch accent and 0.4 timing, so a take with the accent missed but said in time still reads about 40%. Should the headline lean harder on pitch accent until ticket 22 tunes the weights?',
  'Each part shows as a whole percentage with a bar. Would you rather see only the headline, with the parts behind a tap?',
  'The worst stretch plays exactly its 400 ms, with no lead-in. Would a little of the line either side make it easier to hear?',
  "The line's stretch plays at the speed chosen for listening, your take's at its own. Should both follow the chosen speed?",
  'A take that matches fully still shows where it differed most, its least close 400 ms. Should the stretch hide above some match?',
  'The provisional note shows on every score until a native speaker has rated takes. Is it clear, or would a small "provisional" tag beside the number do?',
]

const pickerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.ul(
    [h.AriaLabel('States'), h.Class('flex flex-wrap gap-2')],
    Array.map(sampleScoreNames, (name: SampleScoreName) =>
      h.keyed('li')(
        name,
        [],
        [
          h.button(
            [
              h.Type('button'),
              h.AriaPressed(model.sample === name ? 'true' : 'false'),
              h.OnClick(Message.SelectedSample({ sample: name })),
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

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const take = takeOf(model)
  const { key, learner, note } = learnerOf(take)
  return entryFrame(
    {
      title: 'Score card',
      summary:
        'After a take: its match to this clip, the pitch accent and timing parts by name, and where it differed most, shaded on the curves and playable from both voices; or what to try when it could not be compared.',
      demo: [
        pickerView(model, h),
        curvePairView(
          `${model.sample}:${key}`,
          sampleNative.curve,
          learner,
          note,
          DrawCurvePair,
          h,
        ),
        takePanel(
          take,
          {
            record: Message.ClickedRecord(),
            stop: Message.ClickedStopListening(),
            cancel: Message.ClickedStopListening(),
            listen: (voice, extent) => Message.ClickedListen({ voice, extent }),
            stopListening: Message.ClickedStopListening(),
          },
          h,
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
