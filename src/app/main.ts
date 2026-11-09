import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, Update } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import { MountDevLibrary } from './devLibrary'
import { Message } from './message'
import { AppRoute, homeRouter, urlToAppRoute } from './route'

export { AppRoute } from './route'
export { Message } from './message'

// MODEL

export const Model = Schema.Struct({
  route: AppRoute,
  maybeDevLibraryFailure: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message> = (
  url: Url,
) => ({
  model: { route: urlToAppRoute(url), maybeDevLibraryFailure: Option.none() },
})

// COMMAND

export const NavigateInternal = Command.define('NavigateInternal', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ url }) =>
    pushUrl(url).pipe(Effect.as(Message.CompletedNavigateInternal())),
})

export const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) =>
    load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match<Update.Return<Model, Message>>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({
          model,
          commands: [LoadExternal({ href })],
        }),
      }),

    ChangedUrl: ({ url }) => ({
      model: modifyFields(model, {
        route: () => urlToAppRoute(url),
        maybeDevLibraryFailure: () => Option.none(),
      }),
    }),

    CompletedNavigateInternal: () => ({ model }),
    CompletedLoadExternal: () => ({ model }),
    CompletedMountDevLibrary: () => ({ model }),

    FailedMountDevLibrary: ({ reason }) => ({
      model: modifyFields(model, {
        maybeDevLibraryFailure: () => Option.some(reason),
      }),
    }),
  })

// VIEW

export const tagline =
  'Practise Japanese pitch accent by copying native speakers, line by line, on your own device.'

const homeView = (h: HtmlBuilder<Message>): Html =>
  h.main(
    [
      h.Class(
        'min-h-screen bg-surface text-ink flex flex-col items-center justify-center gap-4 px-6 py-12 text-center',
      ),
    ],
    [
      h.h1([h.Class('text-5xl font-bold tracking-tight')], ['Intone']),
      h.p([h.Class('max-w-md text-lg text-muted')], [tagline]),
    ],
  )

const notFoundView = (path: string, h: HtmlBuilder<Message>): Html =>
  h.main(
    [
      h.Class(
        'min-h-screen bg-surface text-ink flex flex-col items-center justify-center gap-4 px-6 py-12 text-center',
      ),
    ],
    [
      h.h1([h.Class('text-3xl font-bold')], ['Nothing here']),
      h.p(
        [h.Class('max-w-md text-base text-muted break-all')],
        [`The app has no page at ${path}.`],
      ),
      h.a(
        [
          h.Href(homeRouter()),
          h.Class(
            'rounded-md text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          ),
        ],
        ['Go to the start'],
      ),
    ],
  )

const devLibraryView = (
  maybeEntry: Option.Option<string>,
  maybeFailure: Option.Option<string>,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(maybeFailure, {
    onSome: reason =>
      h.main(
        [h.Class('min-h-screen bg-surface text-ink p-6')],
        [
          h.p(
            [h.Role('alert'), h.Class('text-bad')],
            [`The component library did not load: ${reason}`],
          ),
        ],
      ),
    // NOTE: a Mount's args are read once, when its element enters the
    // DOM, so the host is keyed by the entry it opens: moving between
    // entries replaces the element and opens the next one.
    onNone: () =>
      h.keyed('div')(
        Option.getOrElse(maybeEntry, () => ''),
        [h.OnMount(MountDevLibrary({ maybeEntry }))],
      ),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Intone',
  body: AppRoute.match(model.route, {
    Home: () => homeView(h),
    DevLibrary: () =>
      devLibraryView(Option.none(), model.maybeDevLibraryFailure, h),
    DevEntry: ({ entry }) =>
      devLibraryView(Option.some(entry), model.maybeDevLibraryFailure, h),
    NotFound: ({ path }) => notFoundView(path, h),
  }),
})
