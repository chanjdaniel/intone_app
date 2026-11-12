import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { type ListenSpeed, listenSpeeds } from './native'

// Listening again, outside a take: the line at its own speed or slowed
// without changing its pitch, and the learner's last take. Each button
// starts its voice and, while it plays, stops it.

export type ListenControls<ViewMessage> = Readonly<{
  // What plays now, if either.
  playing: 'Line' | 'Take' | 'Nothing'
  canPlayLine: boolean
  canPlayTake: boolean
  speed: ListenSpeed
  listen: (voice: 'Line' | 'Take') => ViewMessage
  stop: ViewMessage
  selectSpeed: (speed: ListenSpeed) => ViewMessage
}>

const buttonClass = `inline-flex min-h-12 min-w-48 items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 text-base font-semibold text-ink disabled:cursor-not-allowed disabled:text-muted disabled:opacity-60 focus-ring`

export const speedLabel = (speed: ListenSpeed): string => `${speed}×`

const speedName = (speed: ListenSpeed): string =>
  speed === 1 ? 'Normal speed' : `${speed} times speed`

const voiceButton = <ViewMessage>(
  controls: ListenControls<ViewMessage>,
  voice: 'Line' | 'Take',
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const playing = controls.playing === voice
  const enabled =
    playing || (voice === 'Line' ? controls.canPlayLine : controls.canPlayTake)
  return h.button(
    [
      h.Type('button'),
      h.Disabled(!enabled),
      h.OnClick(playing ? controls.stop : controls.listen(voice)),
      h.Class(buttonClass),
    ],
    [
      h.span([h.AriaHidden(true), h.Class('text-sm')], [playing ? '■' : '▶']),
      playing ? 'Stop' : voice === 'Line' ? 'Hear the line' : 'Hear your take',
    ],
  )
}

export const listenControls = <ViewMessage>(
  controls: ListenControls<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [h.Class('flex flex-wrap items-center gap-3')],
    [
      voiceButton(controls, 'Line', h),
      h.div(
        [
          h.Role('radiogroup'),
          h.AriaLabel('Speed of the line'),
          h.Class(
            'inline-flex min-h-12 min-w-48 items-stretch overflow-hidden rounded-md border border-line bg-surface',
          ),
        ],
        Array.map(listenSpeeds, speed =>
          h.label(
            [
              h.Class(
                'relative flex min-w-14 flex-1 cursor-pointer items-center justify-center border-line px-3 text-base font-semibold text-muted not-first:border-l has-checked:bg-accent has-checked:text-on-accent has-focus-visible:outline-2 has-focus-visible:-outline-offset-4 has-focus-visible:outline-accent has-checked:has-focus-visible:outline-on-accent',
              ),
            ],
            [
              h.input([
                h.Type('radio'),
                h.Name('listen-speed'),
                h.Value(String(speed)),
                h.Checked(controls.speed === speed),
                h.AriaLabel(speedName(speed)),
                h.OnChange(() => controls.selectSpeed(speed)),
                h.Class('absolute inset-0 cursor-pointer opacity-0'),
              ]),
              h.span([h.AriaHidden(true)], [speedLabel(speed)]),
            ],
          ),
        ),
      ),
      voiceButton(controls, 'Take', h),
    ],
  )
