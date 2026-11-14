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
// plays until the test ends or fails it. `play` stands in for the
// browser's, and may fire the element's events as a browser would.
// `played` waits until playback has asked it to play, which it does only
// once every listener is in place.
const fakeElement = (
  play: (dispatch: (type: string) => void) => Promise<void> = () =>
    Promise.resolve(),
) => {
  const target = new EventTarget()
  const did: Array<string> = []
  const dispatch = (type: string): void => {
    target.dispatchEvent(new Event(type))
  }
  let markPlayed = (): void => undefined
  const played = new Promise<void>(resolve => {
    markPlayed = resolve
  })
  const element: MediaElement = {
    src: '',
    currentTime: 0,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    preservesPitch: false,
    play: () => {
      did.push(
        `play ${element.src}${element.currentTime > 0 ? ` from ${element.currentTime}` : ''} at ${element.playbackRate}, pitch ${element.preservesPitch ? 'kept' : 'moved'}`,
      )
      markPlayed()
      return play(dispatch)
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
    dispatch,
    played: Effect.promise(() => played),
  }
}

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
        yield* fake.played
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
      yield* fake.played
      yield* Fiber.interrupt(fiber)
      expect(fake.did).toStrictEqual([
        'play /line.wav at 1, pitch kept',
        'pause',
        'remove src',
        'load',
      ])
    }),
  )

  it.effect(
    'plays a stretch from its start for as long as it lasts at that speed',
    () =>
      Effect.gen(function* () {
        const fake = fakeElement()
        const fiber = yield* playMedia(() => fake.element)('/line.wav', 0.5, {
          from: 0.25,
          to: 0.65,
        }).pipe(Effect.forkChild)
        yield* fake.played
        expect(fake.did).toStrictEqual([
          'play /line.wav from 0.25 at 0.5, pitch kept',
        ])
        // The clock starts when the sound does.
        yield* TestClock.adjust('2 seconds')
        expect(fiber.pollUnsafe()).toBeUndefined()
        fake.dispatch('playing')
        yield* TestClock.adjust('799 millis')
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust('1 millis')
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        expect(fake.did.slice(1)).toStrictEqual(['pause', 'remove src', 'load'])
      }),
  )

  it.effect(
    'says where it has got to every 50 ms from when the sound starts, until it ends',
    () =>
      Effect.gen(function* () {
        const fake = fakeElement()
        const heard: Array<number> = []
        const fiber = yield* playMedia(() => fake.element)(
          '/clip.wav',
          1,
          { from: 2, to: 3 },
          seconds => heard.push(seconds),
        ).pipe(Effect.forkChild)
        yield* fake.played
        yield* TestClock.adjust('200 millis')
        expect(heard).toStrictEqual([])
        fake.dispatch('playing')
        fake.element.currentTime = 2.05
        yield* TestClock.adjust('50 millis')
        fake.element.currentTime = 2.1
        yield* TestClock.adjust('50 millis')
        expect(heard).toStrictEqual([2, 2.05, 2.1])
        yield* TestClock.adjust('900 millis')
        yield* Fiber.join(fiber)
        const count = heard.length
        yield* TestClock.adjust('200 millis')
        expect(heard).toHaveLength(count)
      }),
  )

  it.effect(
    'hears where it has got to when the sound starts the moment it is played',
    () =>
      Effect.gen(function* () {
        // A browser fires `playing` from a task of its own, which may run
        // before the Effect scheduler's next one: here it comes in the
        // microtask after `play()`, before any task.
        let started = Promise.resolve()
        const fake = fakeElement(dispatch => {
          started = Promise.resolve().then(() => dispatch('playing'))
          return Promise.resolve()
        })
        const heard: Array<number> = []
        const fiber = yield* playMedia(() => fake.element)(
          '/clip.wav',
          1,
          { from: 2, to: 3 },
          seconds => heard.push(seconds),
        ).pipe(Effect.forkChild)
        yield* fake.played
        yield* Effect.promise(() => started)
        expect(heard).toStrictEqual([2])
        yield* Fiber.interrupt(fiber)
      }),
  )

  it.effect('ends a stretch early if the line itself ends first', () =>
    Effect.gen(function* () {
      // The line starts and ends the moment it is played, as one shorter
      // than the stretch's start may.
      const fake = fakeElement(dispatch => {
        void Promise.resolve().then(() => {
          dispatch('playing')
          dispatch('ended')
        })
        return Promise.resolve()
      })
      const exit = yield* playMedia(() => fake.element)('/line.wav', 1, {
        from: 1,
        to: 1.4,
      }).pipe(Effect.exit)
      expect(Exit.isSuccess(exit)).toBe(true)
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
      yield* missing.played
      missing.dispatch('error')
      expect((yield* Fiber.join(fiber)).reason).toBe('The line did not load.')
    }),
  )
})

// A stand-in AudioContext, whose one source ends when the test says.
// `started` waits until playback has started the source.
const fakeContext = () => {
  const did: Array<string> = []
  const source = new EventTarget()
  let markStarted = (): void => undefined
  const started = new Promise<void>(resolve => {
    markStarted = resolve
  })
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
        start: () => {
          did.push('start')
          markStarted()
        },
      }),
    resume: () => Promise.resolve(),
    close: () => {
      did.push('close')
      return Promise.resolve()
    },
  })
  return {
    context,
    did,
    started: Effect.promise(() => started),
    end: () => source.dispatchEvent(new Event('ended')),
  }
}

describe('playing the take', () => {
  it.effect('plays its samples once, then lets the context go', () =>
    Effect.gen(function* () {
      const fake = fakeContext()
      const fiber = yield* playSamples(() => fake.context)(
        new Float32Array(480),
        48_000,
      ).pipe(Effect.forkChild)
      yield* fake.started
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

  it.effect('plays only a stretch of the samples when asked', () =>
    Effect.gen(function* () {
      const fake = fakeContext()
      const fiber = yield* playSamples(() => fake.context)(
        new Float32Array(48_000),
        48_000,
        { from: 0.25, to: 0.65 },
      ).pipe(Effect.forkChild)
      yield* fake.started
      expect(fake.did.slice(0, 2)).toStrictEqual([
        'buffer 1x19200 at 48000',
        'copy 19200',
      ])
      fake.end()
      yield* Fiber.join(fiber)
    }),
  )

  it.effect('is silenced when stopped', () =>
    Effect.gen(function* () {
      const fake = fakeContext()
      const fiber = yield* playSamples(() => fake.context)(
        new Float32Array(480),
        48_000,
      ).pipe(Effect.forkChild)
      yield* fake.started
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
        yield* playback.playLine('/line.wav', 0.5, { from: 0.5, to: 0.9 })
        yield* playback.playTake(new Float32Array(48_000), 48_000, {
          from: 0.2,
          to: 0.6,
        })
      }).pipe(Effect.provide(Playback.layerTest(heard, 1.5)), Effect.forkChild)
      yield* TestClock.adjust('2999 millis')
      expect(heard).toHaveLength(1)
      yield* TestClock.adjust('1001 millis')
      expect(heard).toHaveLength(3)
      yield* TestClock.adjust('800 millis')
      expect(heard).toHaveLength(4)
      yield* TestClock.adjust('400 millis')
      yield* Fiber.join(fiber)
      expect(heard).toStrictEqual([
        { voice: 'Line', url: '/line.wav', rate: 0.5 },
        { voice: 'Take', samples: 48_000, sampleRate: 48_000 },
        {
          voice: 'Line',
          url: '/line.wav',
          rate: 0.5,
          stretch: { from: 0.5, to: 0.9 },
        },
        {
          voice: 'Take',
          samples: 48_000,
          sampleRate: 48_000,
          stretch: { from: 0.2, to: 0.6 },
        },
      ])
    }),
  )
})
