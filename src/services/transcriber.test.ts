import { Effect, Fiber, Stream } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import type { FromText, ToText } from '../workers/text-protocol'
import {
  type TextBrowser,
  type TextDone,
  type TextEvent,
  Transcriber,
  TranscriberError,
  downloadWith,
  textModelBytes,
  textModelOf,
  transcribeWith,
} from './transcriber'
import type { WorkerPort } from './worker-session'

// A stand-in for the text Worker: it records what it is sent, with what
// was transferred, and answers through `reply`, as the real one would.
const fakeWorker = (reply: (message: ToText) => ReadonlyArray<FromText>) => {
  const sent: Array<Readonly<{ message: ToText; transfer: number }>> = []
  const listeners: Record<string, Array<(event: Event) => void>> = {}
  const state = { terminated: false }
  const worker: WorkerPort = {
    postMessage: (message: ToText, transfer?: unknown) => {
      sent.push({
        message,
        transfer: Array.isArray(transfer) ? transfer.length : 0,
      })
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

const pieces = [
  { text: '雨', from: 1.1, to: 1.3 },
  { text: 'が', from: 1.3, to: 1.5 },
]

const answering = (message: ToText): ReadonlyArray<FromText> => {
  if (message._tag === 'Load') {
    return [{ _tag: 'Loaded' }]
  }
  if (message._tag === 'Download') {
    return [
      { _tag: 'Progress', step: 'Downloading', done: 10, total: 20 },
      { _tag: 'Progress', step: 'Downloading', done: 20, total: 20 },
      { _tag: 'Downloaded' },
    ]
  }
  if (message._tag === 'Transcribe') {
    return [
      { _tag: 'Progress', step: 'Downloading', done: 20, total: 20 },
      { _tag: 'Progress', step: 'Preparing', done: 0, total: 1 },
      { _tag: 'Progress', step: 'Transcribing', done: 0, total: 1 },
      { _tag: 'Transcribed', device: 'Wasm', pieces },
    ]
  }
  return [{ _tag: 'Closed' }]
}

const assets = {
  modelsRoot: '/models/',
  wasm: '/ort/x.wasm',
  mjs: '/ort/x.mjs',
}

const browserWith = (worker: WorkerPort, seconds = 12): TextBrowser => ({
  decode: () => Effect.succeed(new Float32Array(seconds * 16_000)),
  makeWorker: () => worker,
  assets,
})

const file = new Blob([new Uint8Array(16)], { type: 'audio/wav' })
const lines = [
  { from: 1, to: 3 },
  { from: 4, to: 6 },
]

describe('the models the learner may choose', () => {
  it('names each by its directory, with every file and its size from the model list', () => {
    const base = textModelOf('whisper-base')
    expect(base.name).toMatch(/^whisper-base\/[0-9a-f]{16}$/)
    expect(base.files.map(each => each.path)).toContain(
      'onnx/encoder_model_q4.onnx',
    )
    expect(textModelBytes('whisper-base')).toBe(
      base.files.reduce((sum, each) => sum + each.bytes, 0),
    )
    // The larger option is about three times the download.
    expect(textModelBytes('whisper-small')).toBeGreaterThan(
      2.5 * textModelBytes('whisper-base'),
    )
  })
})

describe('transcribeWith', () => {
  it.effect(
    "decodes the clip, sends it in the windows Whisper reads, and gives each step and the text's pieces",
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering)
        const events = yield* Stream.runCollect(
          transcribeWith(browserWith(fake.worker))('whisper-base', file, lines),
        )

        expect(events.map(event => event._tag)).toStrictEqual([
          'Decoding',
          'Downloading',
          'Preparing',
          'Transcribing',
          'Transcribed',
        ])
        expect(events.at(-1)).toStrictEqual({
          _tag: 'Transcribed',
          device: 'Wasm',
          pieces,
        })
        expect(fake.sent.map(({ message }) => message._tag)).toStrictEqual([
          'Load',
          'Transcribe',
          'Close',
        ])
        expect(fake.sent[0]?.message).toStrictEqual({ _tag: 'Load', ...assets })
        const transcribe = fake.sent[1]?.message
        expect(transcribe).toMatchObject({
          _tag: 'Transcribe',
          model: textModelOf('whisper-base'),
          windows: [{ from: 0.8, to: 6.2 }],
        })
        expect(fake.sent[1]?.transfer).toBe(1)
        expect(fake.isTerminated()).toBe(true)
      }),
  )

  it.effect('fails with what the Worker said went wrong', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(message =>
        message._tag === 'Transcribe'
          ? [
              {
                _tag: 'Failed',
                reason: 'The text model stopped: out of memory',
              },
            ]
          : answering(message),
      )
      const error = yield* Stream.runDrain(
        transcribeWith(browserWith(fake.worker))('whisper-small', file, lines),
      ).pipe(Effect.flip)

      expect(error).toBeInstanceOf(TranscriberError)
      expect(error.reason).toBe('The text model stopped: out of memory')
      expect(fake.isTerminated()).toBe(true)
    }),
  )

  it.effect('interrupting it asks the Worker to close, and terminates it', () =>
    Effect.gen(function* () {
      const fake = fakeWorker(message =>
        message._tag === 'Transcribe'
          ? [{ _tag: 'Progress', step: 'Transcribing', done: 0, total: 4 }]
          : answering(message),
      )
      const heard: Array<TextEvent | TextDone> = []
      const fiber = yield* transcribeWith(browserWith(fake.worker))(
        'whisper-base',
        file,
        lines,
      ).pipe(
        Stream.runForEach(event => Effect.sync(() => heard.push(event))),
        Effect.forkChild,
      )
      while (!heard.some(event => event._tag === 'Transcribing')) {
        yield* Effect.yieldNow
      }
      yield* Fiber.interrupt(fiber)

      expect(fake.sent.at(-1)?.message._tag).toBe('Close')
      expect(fake.isTerminated()).toBe(true)
    }),
  )
})

describe('downloadWith', () => {
  it.effect(
    'asks the Worker for the model alone, with no clip, until it is on the device',
    () =>
      Effect.gen(function* () {
        const fake = fakeWorker(answering)
        const events = yield* Stream.runCollect(
          downloadWith(browserWith(fake.worker))('whisper-small'),
        )

        expect(events).toStrictEqual([
          { _tag: 'Downloading', done: 10, total: 20 },
          { _tag: 'Downloading', done: 20, total: 20 },
          { _tag: 'Downloaded' },
        ])
        expect(fake.sent[1]).toStrictEqual({
          message: { _tag: 'Download', model: textModelOf('whisper-small') },
          transfer: 0,
        })
      }),
  )
})

describe('the test layer', () => {
  it.effect('answers each request as told, with no Worker', () =>
    Effect.gen(function* () {
      const transcriber = yield* Transcriber
      const events = yield* Stream.runCollect(
        transcriber.transcribe('whisper-base', file, lines),
      )
      expect(events).toStrictEqual([
        { _tag: 'Transcribed', device: 'Wasm', pieces },
      ])
      const error = yield* Stream.runDrain(
        transcriber.download('whisper-small'),
      ).pipe(Effect.flip)
      expect(error.reason).toBe('no')
    }).pipe(
      Effect.provide(
        Transcriber.layerTest(request =>
          request._tag === 'Transcribe'
            ? [{ _tag: 'Transcribed', device: 'Wasm', pieces }]
            : new TranscriberError({ reason: 'no' }),
        ),
      ),
    ),
  )
})
