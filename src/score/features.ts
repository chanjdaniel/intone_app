// What a recording sounds like frame by frame, for the aligner: frames x
// dims, row by row, on the curve's own frames (spec, "The score's
// interface"). They come from src/engine/features, or later from a speech
// model (ticket 20), and are raw: the score normalises them per take, over
// the stretch it compares.
export type Features = Readonly<{
  frameHz: number
  dims: number
  // Frame f's dims are data[f * dims] to data[f * dims + dims - 1].
  data: Float32Array
}>

export const featureFrames = (features: Features): number =>
  features.dims > 0 ? Math.floor(features.data.length / features.dims) : 0
