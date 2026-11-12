import type { Html, HtmlBuilder } from 'foldkit/html'

import { type Place, siteNav } from './siteNav'

// The app's one frame for a screen: its padding and its width, so every
// screen sits alike and a change to one is a change to all. A line's
// practice has it bare; every other screen has the app's places at its
// top (./siteNav.ts).

// The space between a screen's parts: the practice screen's is tighter,
// home's wider, every other screen's in between.
export type FrameGap = 'gap-6' | 'gap-8' | 'gap-10'

export const screenFrame = <ViewMessage>(
  gap: FrameGap,
  body: ReadonlyArray<Html>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.main(
    [h.Class('min-h-screen bg-surface text-ink px-4 py-6 sm:px-6 sm:py-10')],
    [h.div([h.Class(`mx-auto flex max-w-2xl flex-col ${gap}`)], body)],
  )

export const pageFrame = <ViewMessage>(
  place: Place,
  body: ReadonlyArray<Html>,
  h: HtmlBuilder<ViewMessage>,
  gap: FrameGap = 'gap-8',
): Html => screenFrame(gap, [siteNav(place, h), ...body], h)
