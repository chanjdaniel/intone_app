import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { type SourceLink, clockText } from './lines'

// Where a line of the local pack came from, as its manifest gives it: a
// link named by its site and the times in it, opened in a new tab with no
// opener and no referrer. The app only shows it and never fetches it, so a
// YouTube line is something to find again, not audio the app has.

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

// The link's site, as its address names it, without a leading "www.".
export const siteOf = (url: string): string => {
  const host = /^https?:\/\/([^/?#:]+)/i.exec(url)?.[1] ?? url
  return host.replace(/^www\./i, '').toLowerCase()
}

// The times in the source, as 1:03 to 1:06, from 1:03, or none.
export const sourceTimesText = (source: SourceLink): Option.Option<string> =>
  Option.match(source.maybeFrom, {
    onNone: () =>
      Option.map(source.maybeTo, to => `up to ${clockText(to, true)}`),
    onSome: from =>
      Option.some(
        Option.match(source.maybeTo, {
          onNone: () => `from ${clockText(from, true)}`,
          onSome: to => `${clockText(from, true)} to ${clockText(to, true)}`,
        }),
      ),
  })

export const sourceLinkText = (source: SourceLink): string =>
  Option.match(sourceTimesText(source), {
    onNone: () => `Source on ${siteOf(source.url)}`,
    onSome: times => `Source on ${siteOf(source.url)}, ${times}`,
  })

export const sourceLink = <ViewMessage>(
  source: SourceLink,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.a(
    [
      h.Href(source.url),
      h.Target('_blank'),
      h.Rel('noopener noreferrer'),
      h.Class(
        `inline-flex min-h-11 items-center gap-1 self-start rounded-md text-sm text-accent ${focusRing}`,
      ),
    ],
    [
      h.span(
        [h.Class('underline underline-offset-4 break-all')],
        [sourceLinkText(source)],
      ),
      h.span([h.AriaHidden(true)], ['↗']),
      h.span([h.Class('sr-only')], [' (opens in a new tab)']),
    ],
  )
