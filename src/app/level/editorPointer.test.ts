import { Effect, Fiber, Stream } from 'effect'
import { Mount } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../message'
import { FollowLineEditorPointer, secondsAt } from './editorPointer'

// The line editor's pointer Mount on a waveform 1000 px wide showing 10
// s to 14 s of the clip: an edge pressed follows the pointer until it
// lets go, another line pressed is selected, and a press elsewhere puts
// the playhead there.

const waveform = () => {
  const element = document.createElement('div')
  element.setAttribute('data-window-from', '10')
  element.setAttribute('data-window-to', '14')
  element.getBoundingClientRect = () => new DOMRect(100, 0, 1000, 100)
  element.setPointerCapture = () => undefined
  element.releasePointerCapture = () => undefined
  element.hasPointerCapture = () => true
  element.innerHTML = `
    <div data-line-band="selected" data-line-id="4"></div>
    <div data-line-band="other" data-line-id="5"><span>5</span></div>
    <div data-edge="to" data-line-id="4" role="slider"></div>
    <div data-edge="from" data-line-id="4" role="slider" aria-disabled="true"></div>`
  document.body.append(element)
  return element
}

const pointer = (
  type: string,
  clientX: number,
  init: PointerEventInit = {},
): PointerEvent =>
  new PointerEvent(type, {
    clientX,
    pointerId: 1,
    pointerType: 'touch',
    bubbles: true,
    ...init,
  })

const follow = (element: Element, count: number) =>
  FollowLineEditorPointer()
    .f(element, Mount.liveViewStateChanges)
    .pipe(Stream.take(count), Stream.runCollect)

const settled = Effect.promise(
  () => new Promise<void>(resolve => setTimeout(resolve, 0)),
)

describe('the line editor’s pointer', () => {
  it('reads the time under the pointer from the waveform’s own window', () => {
    const element = waveform()
    expect(secondsAt(element, 100)).toBe(10)
    expect(secondsAt(element, 600)).toBe(12)
    expect(secondsAt(element, 5000)).toBe(14)
    element.remove()
  })

  it.effect(
    'drags an edge by touch until it lets go, then selects and places',
    () =>
      Effect.gen(function* () {
        const element = waveform()
        const fiber = yield* follow(element, 6).pipe(Effect.forkChild)
        yield* settled
        const edge = element.querySelector('[data-edge="to"]')
        edge?.dispatchEvent(pointer('pointerdown', 350))
        element.dispatchEvent(pointer('pointermove', 375))
        element.dispatchEvent(pointer('pointermove', 400, { pointerId: 2 }))
        element.dispatchEvent(pointer('pointerup', 400))
        element
          .querySelector('[data-edge="from"]')
          ?.dispatchEvent(pointer('pointerdown', 120))
        element
          .querySelector('[data-line-id="5"] span')
          ?.dispatchEvent(pointer('pointerdown', 900))
        element
          .querySelector('[data-line-band="selected"]')
          ?.dispatchEvent(pointer('pointerdown', 850))
        element.dispatchEvent(
          pointer('pointerdown', 600, { pointerType: 'mouse', button: 2 }),
        )
        element.dispatchEvent(
          pointer('pointerdown', 600, { pointerType: 'mouse', button: 0 }),
        )
        const messages = yield* Fiber.join(fiber)
        expect(messages).toStrictEqual([
          Message.CompletedFollowLineEditorPointer(),
          Message.MovedLineEdge({
            lineId: '4',
            edge: 'to',
            seconds: 11.1,
          }),
          Message.ReleasedLineEdge(),
          Message.SelectedLevelLine({ lineId: '5' }),
          Message.PlacedLevelPlayhead({ seconds: 13 }),
          Message.PlacedLevelPlayhead({ seconds: 12 }),
        ])
        element.remove()
      }),
  )
})
