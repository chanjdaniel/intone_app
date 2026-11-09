import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { historyRouter, homeRouter, settingsRouter } from './route'

// The app's own places, at the top of the screens that are not a line's
// practice: the lines, the history and the settings.

export type Place = 'Lines' | 'History' | 'Settings'

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const places: ReadonlyArray<Readonly<{ place: Place; href: string }>> = [
  { place: 'Lines', href: homeRouter() },
  { place: 'History', href: historyRouter({ maybeFind: Option.none() }) },
  { place: 'Settings', href: settingsRouter() },
]

export const siteNav = <ViewMessage>(
  current: Place,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.nav(
    [h.AriaLabel('Intone'), h.Class('flex justify-end')],
    [
      h.ul(
        [h.Class('flex flex-wrap gap-1')],
        places.map(({ place, href }) =>
          h.li(
            [],
            [
              h.a(
                [
                  h.Href(href),
                  ...(place === current ? [h.AriaCurrent('page')] : []),
                  h.Class(
                    `inline-flex min-h-11 items-center rounded-md px-3 text-base ${
                      place === current
                        ? 'font-semibold text-ink underline decoration-2 underline-offset-8'
                        : 'text-accent hover:underline hover:underline-offset-4'
                    } ${focusRing}`,
                  ),
                ],
                [place],
              ),
            ],
          ),
        ),
      ),
    ],
  )
