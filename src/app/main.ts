import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Document, HtmlBuilder } from 'foldkit/html'

// MODEL

export const Model = Schema.Struct({ screen: Schema.Literal('Home') })
export type Model = typeof Model.Type

// MESSAGE

// The home screen has no controls yet, so nothing can happen to the Model.
export const Message = Schema.Never
export type Message = typeof Message.Type

// UPDATE

export const update = (
  model: Model,
  _message: Message,
): Update.Return<Model, Message> => ({ model })

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: { screen: 'Home' },
})

// VIEW

export const tagline =
  'Practise Japanese pitch accent by copying native speakers, line by line, on your own device.'

export const view = (_model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Intone',
  body: h.main(
    [
      h.Class(
        'min-h-screen bg-white text-gray-900 flex flex-col items-center justify-center gap-4 px-6 py-12 text-center',
      ),
    ],
    [
      h.h1([h.Class('text-5xl font-bold tracking-tight')], ['Intone']),
      h.p([h.Class('max-w-md text-lg text-gray-600')], [tagline]),
    ],
  ),
})
