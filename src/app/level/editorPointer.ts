import { Effect, Queue, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'

import { Message } from '../message'

// The pointer on the line editor's waveform, by mouse, pen or touch: an
// edge pressed is dragged, the pointer held on it until it lets go, and
// each move says where the edge is; a press on another line selects it,
// and a press elsewhere puts the playhead there. The waveform says which
// stretch of the clip it shows in its own data attributes, read at each
// event, so the Mount needs no new args when the view moves on; the
// edges and lines say who they are in theirs. The Messages are
// `messages`', so the /dev library's entries can use their own.

export const windowFromAttribute = 'window-from'
export const windowToAttribute = 'window-to'
export const edgeAttribute = 'edge'
export const lineIdAttribute = 'line-id'
export const lineBandAttribute = 'line-band'

export type PointerMessages<M> = Readonly<{
  moved: (lineId: string, edge: 'from' | 'to', seconds: number) => M
  released: () => M
  placed: (seconds: number) => M
  selected: (lineId: string) => M
  // Said once, when it starts listening.
  listening: () => M
}>

const numberIn = (element: HTMLElement, attribute: string): number =>
  Number(element.getAttribute(`data-${attribute}`))

// Seconds from the clip's start at `clientX` over `element`.
export const secondsAt = (element: HTMLElement, clientX: number): number => {
  const rect = element.getBoundingClientRect()
  const from = numberIn(element, windowFromAttribute)
  const to = numberIn(element, windowToAttribute)
  const share =
    rect.width <= 0
      ? 0
      : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return from + share * (to - from)
}

const closestIn = (
  element: HTMLElement,
  target: EventTarget | null,
  selector: string,
): HTMLElement | null => {
  if (!(target instanceof Element)) {
    return null
  }
  const found = target.closest(selector)
  return found instanceof HTMLElement && element.contains(found) ? found : null
}

const follow = <M>(element: Element, messages: PointerMessages<M>) =>
  Stream.callback<M>(queue =>
    Effect.gen(function* () {
      if (!(element instanceof HTMLElement)) {
        return yield* Effect.never
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const state: {
            drag: {
              pointerId: number
              lineId: string
              edge: 'from' | 'to'
            } | null
          } = { drag: null }
          const offer = (message: M): void => {
            Queue.offerUnsafe(queue, message)
          }
          const onDown = (event: PointerEvent): void => {
            if (event.pointerType === 'mouse' && event.button !== 0) {
              return
            }
            const handle = closestIn(
              element,
              event.target,
              `[data-${edgeAttribute}]`,
            )
            if (handle !== null) {
              const lineId =
                handle.getAttribute(`data-${lineIdAttribute}`) ?? ''
              const edge =
                handle.getAttribute(`data-${edgeAttribute}`) === 'from'
                  ? 'from'
                  : 'to'
              if (handle.getAttribute('aria-disabled') === 'true') {
                return
              }
              event.preventDefault()
              handle.focus()
              element.setPointerCapture(event.pointerId)
              state.drag = { pointerId: event.pointerId, lineId, edge }
              return
            }
            const band = closestIn(
              element,
              event.target,
              `[data-${lineBandAttribute}]`,
            )
            if (
              band !== null &&
              band.getAttribute(`data-${lineBandAttribute}`) !== 'selected'
            ) {
              offer(
                messages.selected(
                  band.getAttribute(`data-${lineIdAttribute}`) ?? '',
                ),
              )
              return
            }
            offer(messages.placed(secondsAt(element, event.clientX)))
          }
          const onMove = (event: PointerEvent): void => {
            const dragging = state.drag
            if (dragging !== null && dragging.pointerId === event.pointerId) {
              offer(
                messages.moved(
                  dragging.lineId,
                  dragging.edge,
                  secondsAt(element, event.clientX),
                ),
              )
            }
          }
          const onUp = (event: PointerEvent): void => {
            const dragging = state.drag
            if (dragging !== null && dragging.pointerId === event.pointerId) {
              state.drag = null
              if (element.hasPointerCapture(event.pointerId)) {
                element.releasePointerCapture(event.pointerId)
              }
              offer(messages.released())
            }
          }
          element.addEventListener('pointerdown', onDown)
          element.addEventListener('pointermove', onMove)
          element.addEventListener('pointerup', onUp)
          element.addEventListener('pointercancel', onUp)
          element.addEventListener('lostpointercapture', onUp)
          offer(messages.listening())
          return { onDown, onMove, onUp }
        }),
        ({ onDown, onMove, onUp }) =>
          Effect.sync(() => {
            element.removeEventListener('pointerdown', onDown)
            element.removeEventListener('pointermove', onMove)
            element.removeEventListener('pointerup', onUp)
            element.removeEventListener('pointercancel', onUp)
            element.removeEventListener('lostpointercapture', onUp)
          }),
      )
      return yield* Effect.never
    }),
  )

export const defineFollowLineEditorPointer = <
  const Messages extends readonly [Schema.Top, ...ReadonlyArray<Schema.Top>],
>(
  results: Messages,
  messages: PointerMessages<Schema.Schema.Type<Messages[number]>>,
) =>
  Mount.defineStream('FollowLineEditorPointer', {
    messages: results,
    execute: ({ element }) => follow(element, messages),
  })

export const FollowLineEditorPointer = defineFollowLineEditorPointer(
  [
    Message.MovedLineEdge,
    Message.ReleasedLineEdge,
    Message.PlacedLevelPlayhead,
    Message.SelectedLevelLine,
    Message.CompletedFollowLineEditorPointer,
  ],
  {
    moved: (lineId, edge, seconds) =>
      Message.MovedLineEdge({ lineId, edge, seconds }),
    released: () => Message.ReleasedLineEdge(),
    placed: seconds => Message.PlacedLevelPlayhead({ seconds }),
    selected: lineId => Message.SelectedLevelLine({ lineId }),
    listening: () => Message.CompletedFollowLineEditorPointer(),
  },
)
