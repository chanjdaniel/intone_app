import { Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'

import { describe, expect, it } from '@effect/vitest'

import {
  type Heard,
  type MediaElement,
  Playback,
  type PlaybackContext,
  playMedia,
  playSamples,
} from './playback'

// A stand-in audio element: it records what playback set and did, and
// plays until the test ends or fails it.
const fakeElement = (play: () => Promise<void> = () => Promise.resolve()) => {
  const target = new EventTarget()
  const did: Array<string> = []
  const element: MediaElement = {
    src: '',
    playbackRate: 1,
    defaultPlaybackRate: 1,
    preservesPitch: false,
    play: () => {
      did.push(
        `play ${element.src} at ${element.playbackRate}, pitch ${element.preservesPitch ? 'kept' : 'moved'}`,
      )
      return play()
    },
    pause: () => {
      did.push('pause')
    },
    load: () => {
      did.push('load')
    },
    removeAttribute: (name: string) => {
      did.push(`remove ${name}`)
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
  return {
    element,
    did,
    dispatch: (type: string) => target.dispatchEvent(new Event(type)),
  }
}

const settled = Effect.promise(
  () => new Promise<void>(resolve => setTimeout(resolve, 0)),
)

describe('playing the line', () => {
  it.effect(
    'plays at the asked speed with its pitch kept, and ends with the sound',
    () =>
      Effect.gen(function* () {
        const fake = fakeElement()
        const fiber = yield* playMedia(() => fake.element)(
          '/line.wav',
          0.5,
        ).pipe(Effect.forkChild)
        yield* settled
        expect(fake.did).toStrictEqual(['play /line.wav at 0.5, pitch kept'])
        expect(fake.element.defaultPlaybackRate).toBe(0.5)
        fake.dispatch('ended')
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        expect(fake.did.slice(1)).toStrictEqual(['pause', 'remove src', 'load'])
      }),
  )

  it.effect('stops at once when stopped', () =>
    Effect.gen(function* () {
      const fake = fakeElement()
      const fiber = yield* playMedia(() => fake.element)('/line.wav', 1).pipe(
        Effect.forkChild,
      )
      yield* settled
      yield* Fiber.interrupt(fiber)
      expect(fake.did).toStrictEqual([
        'play /line.wav at 1, pitch kept',
        'pause',
        'remove src',
        'load',
      ])
    }),
  )

  it.effect('fails when the browser will not play it or it does not load', () =>
    Effect.gen(function* () {
      const refused = fakeElement(() =>
        Promise.reject(new Error('NotAllowedError')),
      )
      const error = yield* playMedia(() => refused.element)(
        '/line.wav',
        1,
      ).pipe(Effect.flip)
      expect(error.reason).toBe('NotAllowedError')

      const missing = fakeElement()
      const fiber = yield* playMedia(() => missing.element)(
        '/gone.wav',
        1,
      ).pipe(Effect.flip, Effect.forkChild)
      yield* settled
      missing.dispatch('error')
      expect((yield* Fiber.join(fiber)).reason).toBe('The line did not load.')
    }),
  )
})

// A stand-in AudioContext, whose one source ends when the test says.
const fakeContext = () => {
  const did: Array<string> = []
  const source = new EventTarget()
  const context: PlaybackContext = Object.assign(Object.create(null), {
    destination: {},
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      did.push(`buffer ${channels}x${length} at ${sampleRate}`)
      return {
        copyToChannel: (samples: Float32Array) =>
          did.push(`copy ${samples.length}`),
      }
    },
    createBufferSource: () =>
      Object.assign(source, {
        buffer: null,
        connect: () => did.push('connect'),
        disconnect: () => did.push('disconnect'),
        start: () => did.push('start'),
      }),
    resume: () => Promise.resolve(),
    close: () => {
      did.push('close')
      return Promise.resolve()
    },
  })
  return { context, did, end: () => source.dispatchEvent(new Event('ended')) }
}

describe('playing the take', () => {
  it.effect('plays its samples once, then lets the context go', () =>
    Effect.gen(function* () {
      const fake = fakeContext()
      const fiber = yield* playSamples(() => fake.context)(
        new Float32Array(480),
        48_000,
      ).pipe(Effect.forkChild)
      yield* settled
      expect(fake.did).toStrictEqual([
        'buffer 1x480 at 48000',
        'copy 480',
        'connect',
        'start',
      ])
      fake.end()
      yield* Fiber.join(fiber)
      expect(fake.did.at(-1)).toBe('close')
    }),
  )

  it.effect('is silenced when stopped', () =>
    Effect.gen(function* () {
      const fake = fakeContext()
      const fiber = yield* playSamples(() => fake.context)(
        new Float32Array(480),
        48_000,
      ).pipe(Effect.forkChild)
      yield* settled
      yield* Fiber.interrupt(fiber)
      expect(fake.did.slice(-2)).toStrictEqual(['disconnect', 'close'])
    }),
  )
})

describe('the test layer', () => {
  it.effect('hears each play and takes as long as its sound', () =>
    Effect.gen(function* () {
      const heard: Array<Heard> = []
      const fiber = yield* Effect.gen(function* () {
        const playback = yield* Playback
        yield* playback.playLine('/line.wav', 0.5)
        yield* playback.playTake(new Float32Array(48_000), 48_000)
      }).pipe(Effect.provide(Playback.layerTest(heard, 1.5)), Effect.forkChild)
      yield* TestClock.adjust('2999 millis')
      expect(heard).toHaveLength(1)
      yield* TestClock.adjust('1001 millis')
      yield* Fiber.join(fiber)
      expect(heard).toStrictEqual([
        { voice: 'Line', url: '/line.wav', rate: 0.5 },
        { voice: 'Take', samples: 48_000, sampleRate: 48_000 },
      ])
    }),
  )
})
