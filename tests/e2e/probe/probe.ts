import { Effect, Stream } from 'effect'

import {
  audioBufferOf,
  playBuffer,
} from '../../../src/engine/audio/buffer-source'
import { decodeWav } from '../../../src/engine/audio/wav'
import { createCaptureNode } from '../../../src/engine/worklet/capture'
import { Microphone } from '../../../src/services/microphone'
import type {
  BufferRequest,
  Capture,
  MicrophoneRequest,
  ServiceRequest,
} from './protocol'

// Collects the worklet's batches until it holds `length` samples.
const collector = (length: number) => {
  const samples = new Float32Array(length)
  const batchLengths: Array<number> = []
  let filled = 0
  let begin = () => {}
  let finish = () => {}
  const started = new Promise<void>(resolve => {
    begin = resolve
  })
  const done = new Promise<void>(resolve => {
    finish = resolve
  })
  const push = (batch: Float32Array): void => {
    begin()
    batchLengths.push(batch.length)
    if (filled < length) {
      samples.set(batch.subarray(0, length - filled), filled)
      filled = Math.min(length, filled + batch.length)
      if (filled === length) {
        finish()
      }
    }
  }
  return { samples, batchLengths, push, started, done }
}

const toBase64 = (samples: Float32Array): string => {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength,
  )
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), character => character.charCodeAt(0))

const capture = (
  sampleRate: number,
  collected: ReturnType<typeof collector>,
  settings: Capture['settings'],
): Capture => ({
  sampleRate,
  samples: toBase64(collected.samples),
  batchLengths: collected.batchLengths,
  settings,
})

// The order the app should follow: the worklet is running before the
// microphone opens, since the fake device plays its file from getUserMedia
// on, and whatever it plays before the source is connected and the context
// renders is lost. The context starts rendering some time after it is
// made, later on a busy machine, so the first batch, not the node, says it
// has started.
const fromMicrophone = async ({
  seconds,
  sampleRate,
  browserProcessing,
}: MicrophoneRequest): Promise<Capture> => {
  const context = new AudioContext({ sampleRate })
  const collected = collector(Math.round(seconds * context.sampleRate))
  const node = await createCaptureNode(context, collected.push)
  await collected.started
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: browserProcessing
      ? true
      : {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
  })
  context.createMediaStreamSource(stream).connect(node)
  await collected.done
  const settings = { ...stream.getAudioTracks()[0]?.getSettings() }
  for (const track of stream.getTracks()) {
    track.stop()
  }
  await context.close()
  return capture(context.sampleRate, collected, settings)
}

const fromBuffer = async ({
  wav,
  seconds,
  sampleRate,
  offline,
}: BufferRequest): Promise<Capture> => {
  const length = Math.round(seconds * sampleRate)
  const context = offline
    ? // Room for the last whole batch past the samples collected.
      new OfflineAudioContext({
        numberOfChannels: 1,
        length: length + sampleRate,
        sampleRate,
      })
    : new AudioContext({ sampleRate })
  const collected = collector(length)
  const node = await createCaptureNode(context, collected.push)
  playBuffer(audioBufferOf(decodeWav(fromBase64(wav))), node)
  if (context instanceof OfflineAudioContext) {
    await context.startRendering()
  }
  await collected.done
  if (context instanceof AudioContext) {
    await context.close()
  }
  return capture(sampleRate, collected, null)
}

// The Microphone service's buffer layer, as a test of the app would use
// it: open, take its batches until `seconds` of them, close.
const fromMicrophoneService = ({
  wav,
  seconds,
}: ServiceRequest): Promise<Capture> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const microphone = yield* Microphone
      const { sampleRate, batches } = yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* microphone.open
          const collected = collector(Math.round(seconds * session.sampleRate))
          yield* session.batches.pipe(
            Stream.runForEach(batch =>
              Effect.sync(() => collected.push(batch)),
            ),
            Effect.race(Effect.promise(() => collected.done)),
          )
          return { sampleRate: session.sampleRate, batches: collected }
        }),
      )
      return capture(sampleRate, batches, null)
    }).pipe(Effect.provide(Microphone.layerBuffer(decodeWav(fromBase64(wav))))),
  )

window.intoneProbe = { fromMicrophone, fromBuffer, fromMicrophoneService }
