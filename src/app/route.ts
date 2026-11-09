import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion, literal, slash, string } from 'foldkit/route'

export const AppRoute = defineRouteUnion({
  Home: {},
  Line: { clipId: Schema.String, lineId: Schema.String },
  // The lines practised, and the words that find among them.
  History: { maybeFind: Schema.Option(Schema.String) },
  LineHistory: { clipId: Schema.String, lineId: Schema.String },
  Settings: {},
  DevLibrary: {},
  DevEntry: { entry: Schema.String },
  NotFound: { path: Schema.String },
})

export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home))

export const lineRouter = pipe(
  literal('line'),
  slash(string('clipId')),
  slash(string('lineId')),
  Route.mapTo(AppRoute.Line),
)

export const historyRouter = pipe(
  literal('history'),
  Route.query(
    Schema.Struct({
      maybeFind: Schema.OptionFromOptionalKey(Schema.String),
    }).pipe(Schema.encodeKeys({ maybeFind: 'find' })),
  ),
  Route.mapTo(AppRoute.History),
)

export const lineHistoryRouter = pipe(
  literal('history'),
  slash(string('clipId')),
  slash(string('lineId')),
  Route.mapTo(AppRoute.LineHistory),
)

export const settingsRouter = pipe(
  literal('settings'),
  Route.mapTo(AppRoute.Settings),
)

export const devLibraryRouter = pipe(
  literal('dev'),
  Route.mapTo(AppRoute.DevLibrary),
)

export const devEntryRouter = pipe(
  literal('dev'),
  slash(string('entry')),
  Route.mapTo(AppRoute.DevEntry),
)

const appRouters = [
  lineRouter,
  lineHistoryRouter,
  historyRouter,
  settingsRouter,
  homeRouter,
] as const

// The /dev library is registered only in development: a production build
// drops this branch, so its routes parse to NotFound there.
const routeParser = import.meta.env.DEV
  ? Route.oneOf(devEntryRouter, devLibraryRouter, ...appRouters)
  : Route.oneOf(...appRouters)

export const urlToAppRoute = Route.parseUrlWithFallback(
  routeParser,
  AppRoute.NotFound,
)
