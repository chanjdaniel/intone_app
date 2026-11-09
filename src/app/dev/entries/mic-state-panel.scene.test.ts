import { Array } from 'effect'
import { Mount, click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import {
  DrawLiveCurve,
  Message,
  PaintCurve,
  init,
  samples,
  update,
  view,
} from './mic-state-panel'

describe('the mic state panel entry', () => {
  test('offers every state a take can be in', () => {
    scene(
      { update, view },
      given(init().model),
      ...Array.map(samples, ({ name }) =>
        expect(role('button', { name })).toExist(),
      ),
      expect(text('Read-out: Idle: Idle; no button pressed yet')).toExist(),
    )
  })

  test('shows the picked state and reads out the button pressed in it', () => {
    scene(
      { update, view },
      given(init().model),
      click(role('button', { name: 'Recording' })),
      expect(role('heading', { name: 'Recording', level: 2 })).toExist(),
      Mount.resolve(DrawLiveCurve, Message.CompletedDrawLiveCurve()),
      expect(role('timer')).toHaveText('0:02 of 0:30'),
      expect(role('meter', { name: 'Microphone level' })).toHaveAttr(
        'aria-valuetext',
        'good',
      ),
      click(role('button', { name: 'Stop' })),
      expect(text('Read-out: Recording: Recording; pressed stop')).toExist(),
      click(role('button', { name: 'Denied' })),
      Mount.expectEnded(DrawLiveCurve),
      expect(role('heading', { name: 'The microphone is blocked' })).toExist(),
      click(role('button', { name: 'Try again' })),
      expect(text('Read-out: Denied: MicDenied; pressed record')).toExist(),
    )
  })

  test('paints the curve state with its own Mount', () => {
    scene(
      { update, view },
      given(init().model),
      click(role('button', { name: 'Curve' })),
      Mount.resolve(PaintCurve, Message.CompletedPaintCurve()),
      expect(role('heading', { name: 'Your pitch' })).toExist(),
      expect(role('img', { name: /^Your pitch curve, 1\.38 s/ })).toExist(),
    )
  })
})
