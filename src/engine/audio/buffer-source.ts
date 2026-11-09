import type { Wav } from './wav'

// Plays decoded audio into a node in the same graph a microphone feeds, so
// tests drive the capture worklet without one.

// An AudioBuffer of the decoded samples at their own rate; Web Audio
// resamples it to the context's when it plays.
export const audioBufferOf = ({ sampleRate, channels }: Wav): AudioBuffer => {
  const buffer = new AudioBuffer({
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    sampleRate,
  })
  channels.forEach((channel, index) => {
    // copyToChannel takes a Float32Array backed by a plain ArrayBuffer.
    buffer.copyToChannel(Float32Array.from(channel), index)
  })
  return buffer
}

export type BufferPlayback = Readonly<{
  // Settles when the buffer has played to its end or been stopped.
  ended: Promise<void>
  stop: () => void
}>

// Starts `buffer` into `destination` at once: its first sample is the
// first the destination hears from it.
export const playBuffer = (
  buffer: AudioBuffer,
  destination: AudioNode,
): BufferPlayback => {
  const source = new AudioBufferSourceNode(destination.context, { buffer })
  source.connect(destination)
  const ended = new Promise<void>(resolve => {
    source.addEventListener('ended', () => {
      source.disconnect()
      resolve()
    })
  })
  source.start()
  return { ended, stop: () => source.stop() }
}
