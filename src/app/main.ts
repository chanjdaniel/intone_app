import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, Update } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import { MountDevLibrary } from './devLibrary'
import { Message } from './message'
import { type Model } from './model'
import { AppRoute, homeRouter, urlToAppRoute } from './route'
import { PaintCurve } from './take/curveView'
import { DrawLiveCurve } from './take/liveCurveView'
import { takePanel } from './take/panel'
import type { TakeResourceServices } from './take/resources'
import { Take } from './take/take'
import * as TakeUpdate from './take/update'

export { AppRoute } from './route'
export { Message } from './message'
export { Model } from './model'
export { managedResources } from './take/resources'
export { subscriptions } from './take/subscriptions'

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message> = (
  url: Url,
) => ({
  model: {
    route: urlToAppRoute(url),
    maybeDevLibraryFailure: Option.none(),
    take: Take.Idle(),
    takesStarted: 0,
  },
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

type UpdateReturn = Update.Return<Model, Message, TakeResourceServices>

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({
          model,
          commands: [LoadExternal({ href })],
        }),
      }),

    ChangedUrl: ({ url }) => {
      const route = urlToAppRoute(url)
      const routed = modifyFields(model, {
        route: () => route,
        maybeDevLibraryFailure: () => Option.none(),
      })
      return {
        model: route._tag === 'Home' ? routed : TakeUpdate.leftScreen(routed),
      }
    },

    CompletedNavigateInternal: () => ({ model }),
    CompletedLoadExternal: () => ({ model }),
    CompletedMountDevLibrary: () => ({ model }),

    FailedMountDevLibrary: ({ reason }) => ({
      model: modifyFields(model, {
        maybeDevLibraryFailure: () => Option.some(reason),
      }),
    }),

    ClickedRecord: () => TakeUpdate.clickedRecord(model),
    ClickedStop: () => TakeUpdate.clickedStop(model),
    ClickedCancelTake: () => TakeUpdate.clickedCancelTake(model),
    AcquiredTracker: () => TakeUpdate.acquiredTracker(model),
    FailedAcquireTracker: ({ reason }) =>
      TakeUpdate.failedAcquireTracker(model, reason),
    ReleasedTracker: () => ({ model }),
    AcquiredMicrophone: () => TakeUpdate.acquiredMicrophone(model),
    FailedAcquireMicrophone: ({ failure, reason }) =>
      TakeUpdate.failedAcquireMicrophone(model, failure, reason),
    ReleasedMicrophone: () => ({ model }),
    CompletedWaitForMicAnswer: ({ takeNumber }) =>
      TakeUpdate.completedWaitForMicAnswer(model, takeNumber),
    TickedTakeMeter: ({ takeNumber, elapsedSeconds, levelDb }) =>
      TakeUpdate.tickedTakeMeter(model, takeNumber, elapsedSeconds, levelDb),
    DetectedVoiceOnset: ({ takeNumber, onsetSeconds }) =>
      TakeUpdate.detectedVoiceOnset(model, takeNumber, onsetSeconds),
    FailedRecordTake: ({ takeNumber, reason }) =>
      TakeUpdate.failedRecordTake(model, takeNumber, reason),
    SucceededAnalyseTake: ({ takeNumber, result }) =>
      TakeUpdate.succeededAnalyseTake(model, takeNumber, result),
    FailedAnalyseTake: ({ takeNumber, reason }) =>
      TakeUpdate.failedAnalyseTake(model, takeNumber, reason),
    CompletedFocusTakeControl: () => ({ model }),
    CompletedPaintCurve: () => ({ model }),
    CompletedDrawLiveCurve: () => ({ model }),
  })

// VIEW

export const tagline =
  'Practise Japanese pitch accent by copying native speakers, line by line, on your own device.'

const homeView = (take: Take, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Class('min-h-screen bg-surface text-ink px-4 py-10 sm:px-6 sm:py-16')],
    [
      h.div(
        [h.Class('mx-auto flex max-w-2xl flex-col gap-8')],
        [
          h.header(
            [h.Class('flex flex-col gap-3 text-center')],
            [
              h.h1([h.Class('text-5xl font-bold tracking-tight')], ['Intone']),
              h.p([h.Class('mx-auto max-w-md text-lg text-muted')], [tagline]),
            ],
          ),
          takePanel(
            take,
            {
              record: Message.ClickedRecord(),
              stop: Message.ClickedStop(),
              cancel: Message.ClickedCancelTake(),
              paint: PaintCurve,
              drawLive: DrawLiveCurve,
            },
            h,
          ),
        ],
      ),
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
            'inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
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
    Home: () => homeView(model.take, h),
    DevLibrary: () =>
      devLibraryView(Option.none(), model.maybeDevLibraryFailure, h),
    DevEntry: ({ entry }) =>
      devLibraryView(Option.some(entry), model.maybeDevLibraryFailure, h),
    NotFound: ({ path }) => notFoundView(path, h),
  }),
})
