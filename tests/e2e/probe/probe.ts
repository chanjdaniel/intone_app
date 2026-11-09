import { audioBufferOf, playBuffer } from '../../../src/engine/audio/buffer-source'
import { decodeWav } from '../../../src/engine/audio/wav'
import { createCaptureNode } from '../../../src/engine/worklet/capture'
import type { BufferRequest, Capture, MicrophoneRequest } from './protocol'

// Collects the worklet's batches until it holds `length` samples.
const collector = (length: number) => {
  const samples = new Float32Array(length)
  const batchLengths: Array<number> = []
  let filled = 0
  let finish = () => {}
  const done = new Promise<void>(resolve => {
    finish = resolve
  })
  const push = (batch: Float32Array): void => {
    batchLengths.push(batch.length)
    if (filled < length) {
      samples.set(batch.subarray(0, length - filled), filled)
      filled = Math.min(length, filled + batch.length)
      if (filled === length) {
        finish()
      }
    }
  }
  return { samples, batchLengths, push, done }
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

// The order the app follows: the worklet is ready before the microphone
// opens, since the fake device plays its file from getUserMedia on, and
// whatever arrives before the source is connected is lost.
const fromMicrophone = async ({
  seconds,
  sampleRate,
  browserProcessing,
}: MicrophoneRequest): Promise<Capture> => {
  const context = new AudioContext(sampleRate === null ? {} : { sampleRate })
  const collected = collector(Math.round(seconds * context.sampleRate))
  const node = await createCaptureNode(context, collected.push)
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

window.intoneProbe = { fromMicrophone, fromBuffer }
