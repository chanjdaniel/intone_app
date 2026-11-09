// Allowed: src/engine may use browser APIs; only src/score may not.
import { semitones } from '../../score/semitones'

export const paint = (canvas: HTMLCanvasElement): void => {
  const context = canvas.getContext('2d')
  context?.fillRect(0, 0, semitones(window.devicePixelRatio), 1)
}
