// What a recording sounds like frame by frame, for the aligner: frames x
// dims, row by row, on the curve's own frames (spec, "The score's
// interface"). They come from src/engine/features, or from a speech
// model's frames put on the curve's (`onCurveFrames`), and are raw: the
// score normalises them per take, over the stretch it compares.
export type Features = Readonly<{
  frameHz: number
  dims: number
  // Frame f's dims are data[f * dims] to data[f * dims + dims - 1].
  data: Float32Array
}>

export const featureFrames = (features: Features): number =>
  features.dims > 0 ? Math.floor(features.data.length / features.dims) : 0

// A speech model's frames, whose first is centred `firstFrameSeconds`
// into the recording, put on `frames` frames at `frameHz` (the curve's,
// frame f at f / frameHz seconds), each dim read straight between the
// model frames either side and held past either end: how a model's
// features go through the `Aligner` interface in place of the log mel
// bands (docs/sounds.md, "The aligner").
export const onCurveFrames = (
  model: Features,
  firstFrameSeconds: number,
  frameHz: number,
  frames: number,
): Features => {
  const { dims } = model
  const modelFrames = featureFrames(model)
  const data = new Float32Array(frames * dims)
  if (modelFrames === 0) {
    return { frameHz, dims, data }
  }
  for (let f = 0; f < frames; f++) {
    const at = Math.min(
      modelFrames - 1,
      Math.max(0, (f / frameHz - firstFrameSeconds) * model.frameHz),
    )
    const low = Math.floor(at)
    const high = Math.min(modelFrames - 1, low + 1)
    const share = at - low
    for (let d = 0; d < dims; d++) {
      data[f * dims + d] =
        (model.data[low * dims + d] ?? 0) * (1 - share) +
        (model.data[high * dims + d] ?? 0) * share
    }
  }
  return { frameHz, dims, data }
}
