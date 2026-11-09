import { Array } from 'effect'
import { Runtime } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'

// What each file in `./entries/` exports: its own small Foldkit program,
// which the library embeds into a container it owns.

export type DevEntryProgram = Runtime.MakeRuntimeReturn<
  undefined,
  void,
  never,
  'Element'
>

export type DevEntry = Readonly<{
  makeProgram: (container: HTMLElement) => DevEntryProgram
}>

export type DevEntryModule = Readonly<{ entry: DevEntry }>

export const libraryPath = '/dev'

export const entryPath = (name: string): string => `${libraryPath}/${name}`

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

// Standalone links reach the 44 px touch target.
export const linkClass = `inline-flex min-h-11 items-center rounded-sm text-accent underline underline-offset-4 ${focusRing}`

export const buttonFocusClass = focusRing

// The frame every entry page shares: where it sits in the library, the
// live demo, the read-out line under it, and the "Choices for you" note.
export const entryFrame = <Message>(
  frame: Readonly<{
    title: string
    summary: string
    demo: ReadonlyArray<Html>
    readOut: string
    choices: ReadonlyArray<string>
  }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.main(
    [h.Class('min-h-screen bg-surface text-ink')],
    [
      h.div(
        [h.Class('mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6')],
        [
          h.nav(
            [h.AriaLabel('Component library')],
            [h.a([h.Href(libraryPath), h.Class(linkClass)], ['All entries'])],
          ),
          h.header(
            [h.Class('flex flex-col gap-2')],
            [
              h.p([h.Class('text-sm text-muted')], ['Component library']),
              h.h1([h.Class('text-3xl font-bold')], [frame.title]),
              h.p([h.Class('text-base text-muted')], [frame.summary]),
            ],
          ),
          h.section(
            [h.AriaLabel('Demo'), h.Class('flex flex-col gap-8')],
            frame.demo,
          ),
          h.p(
            [
              h.AriaLive('polite'),
              h.Class(
                'rounded-md border border-line bg-raised px-4 py-3 font-mono text-sm',
              ),
            ],
            [`Read-out: ${frame.readOut}`],
          ),
          h.section(
            [h.Class('flex flex-col gap-3')],
            [
              h.h2([h.Class('text-xl font-bold')], ['Choices for you']),
              h.ul(
                [h.Class('flex list-disc flex-col gap-2 pl-6 text-base')],
                Array.map(frame.choices, choice => h.li([], [choice])),
              ),
            ],
          ),
        ],
      ),
    ],
  )
