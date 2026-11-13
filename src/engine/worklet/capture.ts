import processorUrl from './capture-processor.ts?worker&url'

// Kept equal to the name capture-processor.ts registers.
const processorName = 'intone-capture'

// The capture worklet's node in `context`, ready for a source to connect:
// whatever reaches its one input is mixed down to mono, and every 20 ms of
// it reaches `onBatch` as a Float32Array the caller owns, in order, with
// nothing dropped, silence while nothing is connected. It has no output;
// nothing needs to pull it.
export const createCaptureNode = async (
  context: BaseAudioContext,
  onBatch: (batch: Float32Array) => void,
): Promise<AudioWorkletNode> => {
  await context.audioWorklet.addModule(processorUrl)
  const node = new AudioWorkletNode(context, processorName, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  })
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    onBatch(event.data)
  }
  return node
}
