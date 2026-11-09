// The capture worklet: runs on the audio thread, copies each block of its
// one input channel into a ring buffer allocated once, and posts every
// 20 ms of samples to the main thread as a Float32Array it transfers.
// `capture.ts` loads it and builds its node, mixed down to mono.
//
// It imports nothing, since an audio worklet module is loaded on its own,
// and allocates nothing per block: the one allocation is each batch it
// hands over, about every seventh block at 48 kHz.

// A module, so these name the audio worklet's globals, which TypeScript's
// libraries leave out, in this file only.
export {}

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void

// Kept equal to the name in capture.ts, which cannot import this file.
const processorName = 'intone-capture'
const batchSeconds = 0.02
// A block is 128 frames today; the ring holds a batch and a block far
// larger than that.
const largestBlock = 4096

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly batchLength = Math.round(sampleRate * batchSeconds)
  private readonly ring = new Float32Array(this.batchLength + largestBlock)
  // Samples written into and taken out of the ring since the start.
  private written = 0
  private taken = 0

  process(inputs: ReadonlyArray<ReadonlyArray<Float32Array>>): boolean {
    const channel = inputs[0]?.[0]
    if (channel === undefined) {
      return true
    }
    const { ring } = this
    for (let i = 0; i < channel.length; i++) {
      ring[(this.written + i) % ring.length] = channel[i] ?? 0
    }
    this.written += channel.length
    while (this.written - this.taken >= this.batchLength) {
      const batch = new Float32Array(this.batchLength)
      for (let i = 0; i < batch.length; i++) {
        batch[i] = ring[(this.taken + i) % ring.length] ?? 0
      }
      this.taken += batch.length
      this.port.postMessage(batch, [batch.buffer])
    }
    return true
  }
}

registerProcessor(processorName, CaptureProcessor)
