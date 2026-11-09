import {
  Array,
  Effect,
  Option,
  Record,
  Schema,
  Scope,
  String,
  pipe,
} from 'effect'
import { Runtime } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'

import {
  type DevEntryModule,
  type DevEntryProgram,
  entryPath,
  libraryPath,
  linkClass,
} from './entry'

// The /dev component library, development builds only. The app opens it
// through `../devLibrary.ts`; nothing imports this folder statically.

// The whole list of entries, written once. An entry is built when a file
// `./entries/<name>.ts` exists; until then the index lists it as coming, so
// each later piece of work adds only its own file.
export const plannedEntries: ReadonlyArray<
  Readonly<{ name: string; title: string }>
> = [
  { name: 'tokens', title: 'Tokens' },
  { name: 'curve-view', title: 'Curve view' },
  { name: 'mic-state-panel', title: 'Mic state panel' },
  { name: 'score-card', title: 'Score card' },
  { name: 'star-row', title: 'Star row' },
  { name: 'line-row', title: 'Line row' },
]

const entryModules = import.meta.glob<DevEntryModule>([
  './entries/*.ts',
  '!./entries/*.test.ts',
])

const entryNameFromPath = (path: string): string =>
  pipe(path, String.replace('./entries/', ''), String.replace(/\.ts$/, ''))

export const builtEntryNames: ReadonlyArray<string> = Array.map(
  Record.keys(entryModules),
  entryNameFromPath,
)

export const isBuilt = (name: string): boolean =>
  Array.contains(builtEntryNames, name)

export class DevEntryLoadError extends Schema.TaggedError<
  DevEntryLoadError,
  { readonly brand: unique symbol }
>()('DevEntryLoadError', { entry: Schema.String, cause: Schema.Defect() }) {}

// PAGES WITHOUT AN ENTRY FILE

const Static = Schema.Struct({})

const pageClass = 'min-h-screen bg-surface text-ink'
const columnClass = 'mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6'

export const indexView = <Message>(h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Class(pageClass)],
    [
      h.div(
        [h.Class(columnClass)],
        [
          h.header(
            [h.Class('flex flex-col gap-2')],
            [
              h.p(
                [h.Class('text-sm text-muted')],
                ['Intone, development only'],
              ),
              h.h1([h.Class('text-3xl font-bold')], ['Component library']),
              h.p(
                [h.Class('text-base text-muted')],
                [
                  'Each entry renders one of the app\'s own components with the app\'s own styles, with a read-out line under its demo and a "Choices for you" note at the end.',
                ],
              ),
            ],
          ),
          h.ul(
            [
              h.Class(
                'flex flex-col divide-y divide-line border-y border-line',
              ),
            ],
            Array.map(plannedEntries, ({ name, title }) =>
              h.keyed('li')(
                name,
                [h.Class('flex items-center justify-between gap-4 py-3')],
                isBuilt(name)
                  ? [
                      h.a(
                        [
                          h.Href(entryPath(name)),
                          h.Class(`text-lg ${linkClass}`),
                        ],
                        [title],
                      ),
                    ]
                  : [
                      h.span([h.Class('text-lg text-muted')], [title]),
                      h.span(
                        [
                          h.Class(
                            'rounded-full border border-line px-3 text-sm text-muted',
                          ),
                        ],
                        ['coming'],
                      ),
                    ],
              ),
            ),
          ),
        ],
      ),
    ],
  )

export const notBuiltView = <Message>(
  name: string,
  h: HtmlBuilder<Message>,
): Html => {
  const maybePlanned = Array.findFirst(
    plannedEntries,
    entry => entry.name === name,
  )
  return h.main(
    [h.Class(pageClass)],
    [
      h.div(
        [h.Class(columnClass)],
        [
          h.nav(
            [h.AriaLabel('Component library')],
            [h.a([h.Href(libraryPath), h.Class(linkClass)], ['All entries'])],
          ),
          h.h1(
            [h.Class('text-3xl font-bold')],
            [
              Option.match(maybePlanned, {
                onSome: ({ title }) => title,
                onNone: () => 'No such entry',
              }),
            ],
          ),
          h.p(
            [h.Class('text-base text-muted')],
            [
              Option.match(maybePlanned, {
                onSome: ({ title }) =>
                  `${title} is coming: its entry is not built yet.`,
                onNone: () => `The library has no entry named "${name}".`,
              }),
            ],
          ),
        ],
      ),
    ],
  )
}

const staticProgram =
  (pageView: <Message>(h: HtmlBuilder<Message>) => Html) =>
  (container: HTMLElement): DevEntryProgram =>
    Runtime.makeElement({
      Model: Static,
      init: () => ({ model: {} }),
      update: (model: typeof Static.Type, _message: never) => ({ model }),
      view: (_model, h) => pageView(h),
      container,
    })

// OPENING A PAGE

const programFor = (
  maybeEntry: Option.Option<string>,
): Effect.Effect<
  (container: HTMLElement) => DevEntryProgram,
  DevEntryLoadError
> =>
  Option.match(maybeEntry, {
    onNone: () => Effect.succeed(staticProgram(indexView)),
    onSome: name =>
      Option.match(Record.get(entryModules, `./entries/${name}.ts`), {
        onNone: () => Effect.succeed(staticProgram(h => notBuiltView(name, h))),
        onSome: load =>
          Effect.tryPromise({
            try: load,
            catch: cause => new DevEntryLoadError({ entry: name, cause }),
          }).pipe(Effect.map(module => module.entry.makeProgram)),
      }),
  })

// Renders the index, or the named entry, inside `host` until the scope
// closes: the page's program runs in a container of its own, so the app's
// view never patches over it, and closing the scope disposes the program
// and removes the container.
export const open = (
  host: Element,
  maybeEntry: Option.Option<string>,
): Effect.Effect<void, DevEntryLoadError, Scope.Scope> =>
  Effect.gen(function* () {
    const makeProgram = yield* programFor(maybeEntry)
    const container = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const element = document.createElement('div')
        // Foldkit keeps a development Model across reloads by container id.
        element.id = 'dev-library-page'
        return host.appendChild(element)
      }),
      element => Effect.sync(() => element.remove()),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => Runtime.embed(makeProgram(container))),
      handle => Effect.sync(() => handle.dispose()),
    )
  })
