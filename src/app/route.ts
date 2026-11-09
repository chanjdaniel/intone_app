import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion, literal, slash, string } from 'foldkit/route'

export const AppRoute = defineRouteUnion({
  Home: {},
  DevLibrary: {},
  DevEntry: { entry: Schema.String },
  NotFound: { path: Schema.String },
})

export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home))

export const devLibraryRouter = pipe(
  literal('dev'),
  Route.mapTo(AppRoute.DevLibrary),
)

export const devEntryRouter = pipe(
  literal('dev'),
  slash(string('entry')),
  Route.mapTo(AppRoute.DevEntry),
)

// The /dev library is registered only in development: a production build
// drops this branch, so its routes parse to NotFound there.
const routeParser = import.meta.env.DEV
  ? Route.oneOf(devEntryRouter, devLibraryRouter, homeRouter)
  : Route.oneOf(homeRouter)

export const urlToAppRoute = Route.parseUrlWithFallback(
  routeParser,
  AppRoute.NotFound,
)
