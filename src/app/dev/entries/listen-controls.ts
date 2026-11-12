import { Option, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { listenControls } from '../../line/listenControls'
import { ListenSpeed } from '../../line/native'
import { Voice } from '../../take/take'
import { type DevEntry, entryFrame } from '../entry'

// The controls for listening again, with nothing playing: each button
// toggles its voice as the practice screen's Model would, and the take's
// button waits for a take.

// MODEL

export const Model = Schema.Struct({
  maybePlaying: Schema.Option(Voice),
  hasTake: Schema.Boolean,
  speed: ListenSpeed,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedListen: { voice: Voice },
  ClickedStopListening: {},
  SelectedListenSpeed: { speed: ListenSpeed },
  ClickedToggleTake: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { maybePlaying: Option.none(), hasTake: false, speed: 1 },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedListen: ({ voice }) => ({
      model: modifyFields(model, { maybePlaying: () => Option.some(voice) }),
    }),
    ClickedStopListening: () => ({
      model: modifyFields(model, { maybePlaying: () => Option.none() }),
    }),
    SelectedListenSpeed: ({ speed }) => ({
      model: modifyFields(model, { speed: () => speed }),
    }),
    ClickedToggleTake: () => ({
      model: modifyFields(model, {
        hasTake: hasTake => !hasTake,
        maybePlaying: () => Option.none(),
      }),
    }),
  })

// VIEW

export const readOut = (model: Model): string =>
  `${Option.match(model.maybePlaying, {
    onNone: () => 'nothing playing',
    onSome: voice => `playing the ${voice === 'Line' ? 'line' : 'take'}`,
  })}, speed ${model.speed}, ${model.hasTake ? 'a take to hear' : 'no take yet'}`

export const choices: ReadonlyArray<string> = [
  'The line slows to 0.75 and 0.5 times its speed with its pitch kept, for listening only: before a take it always plays at its own speed, so you copy its real timing. Would you rather the take copied the slowed line?',
  'Changing the speed while the line plays starts it again at the new speed. Should it carry on from where it was instead?',
  'Your take stays in memory only, until you record again or leave the line. Should the app offer to keep it?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Listen controls',
      summary:
        'Listening again outside a take: the line, slowed if you like without changing its pitch, and your own last take.',
      demo: [
        h.button(
          [
            h.Type('button'),
            h.AriaPressed(model.hasTake ? 'true' : 'false'),
            h.OnClick(Message.ClickedToggleTake()),
            h.Class(
              `inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-3 text-sm aria-pressed:border-accent aria-pressed:bg-raised aria-pressed:ring-1 aria-pressed:ring-accent focus-ring`,
            ),
          ],
          ['A take has finished'],
        ),
        listenControls(
          {
            playing: Option.getOrElse(
              model.maybePlaying,
              () => 'Nothing' as const,
            ),
            canPlayLine: true,
            canPlayTake: model.hasTake,
            speed: model.speed,
            listen: voice => Message.ClickedListen({ voice }),
            stop: Message.ClickedStopListening(),
            selectSpeed: speed => Message.SelectedListenSpeed({ speed }),
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
