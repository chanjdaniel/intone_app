import { Effect, Exit } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import type { FromReadings, ToReadings } from '../workers/readings-protocol'
import { ReadingsError, openReadingsWith } from './readings'
import type { WorkerPort } from './worker-session'

// A stand-in for the readings Worker: it records what it is sent and
// answers through `reply`, as the real one would.
const fakeWorker = (
  reply: (message: ToReadings) => ReadonlyArray<FromReadings>,
) => {
  const sent: Array<ToReadings> = []
  const listeners: Record<string, Array<(event: Event) => void>> = {}
  const state = { terminated: false }
  const worker: WorkerPort = {
    postMessage: (message: ToReadings) => {
      sent.push(message)
      reply(message).forEach(data => {
        queueMicrotask(() => {
          ;(listeners.message ?? []).forEach(listener =>
            listener(new MessageEvent('message', { data })),
          )
        })
      })
    },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      listeners[type] = [...(listeners[type] ?? []), listener]
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners[type] = (listeners[type] ?? []).filter(
        existing => existing !== listener,
      )
    },
    terminate: () => {
      state.terminated = true
    },
  }
  return { worker, sent, isTerminated: () => state.terminated }
}

const answering = (message: ToReadings): ReadonlyArray<FromReadings> => {
  if (message._tag === 'Load') {
    return [{ _tag: 'Loaded' }]
  }
  if (message._tag === 'Read') {
    return [
      {
        _tag: 'Tokens',
        texts: message.texts.map(() => [
          { surface: '雨', reading: 'アメ' },
          { surface: 'が', reading: 'ガ' },
          { surface: '好き', reading: 'スキ' },
        ]),
      },
    ]
  }
  return [{ _tag: 'Closed' }]
}

const dictionary = { url: '/dictionary.zip', bytes: 10 }

describe('the readings', () => {
  it.effect(
    "loads the dictionary named, reads each text's words, and frees the Worker when its scope closes",
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering)
        const words = yield* Effect.scoped(
          openReadingsWith({ makeWorker: () => fake.worker, dictionary }).pipe(
            Effect.flatMap(session => session.read(['雨が好き'])),
          ),
        )

        expect(words).toStrictEqual([
          [
            { from: 0, to: 1, surface: '雨', kana: 'あめ' },
            { from: 1, to: 2, surface: 'が', kana: null },
            { from: 2, to: 4, surface: '好き', kana: 'すき' },
          ],
        ])
        expect(fake.sent).toStrictEqual([
          { _tag: 'Load', dictionary: dictionary.url, bytes: 10 },
          { _tag: 'Read', texts: ['雨が好き'] },
          { _tag: 'Close' },
        ])
        expect(fake.isTerminated()).toBe(true)
      }),
  )

  it.effect(
    "fails with the Worker's reason when the dictionary does not load",
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(message =>
          message._tag === 'Load'
            ? [
                {
                  _tag: 'Failed',
                  reason: 'The reading dictionary could not be downloaded.',
                },
              ]
            : [{ _tag: 'Closed' }],
        )
        const exit = yield* Effect.exit(
          Effect.scoped(
            openReadingsWith({ makeWorker: () => fake.worker, dictionary }),
          ),
        )

        expect(exit).toStrictEqual(
          Exit.fail(
            new ReadingsError({
              reason: 'The reading dictionary could not be downloaded.',
            }),
          ),
        )
        expect(fake.isTerminated()).toBe(true)
      }),
  )
})
