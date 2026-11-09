// What the fake-microphone probe page offers its Playwright test, as
// `window.intoneProbe`.

export type Capture = Readonly<{
  sampleRate: number
  // Little-endian 32-bit float samples, base64.
  samples: string
  // Each batch's length, in the order the worklet posted them.
  batchLengths: ReadonlyArray<number>
  // The microphone track's settings, as getSettings() read them.
  settings: Readonly<Record<string, unknown>> | null
}>

export type MicrophoneRequest = Readonly<{
  seconds: number
  // The AudioContext's rate.
  sampleRate: number
  // Echo cancellation, noise suppression and auto gain as the browser
  // sets them by default, instead of off as the app asks.
  browserProcessing: boolean
}>

export type BufferRequest = Readonly<{
  // A WAV file, base64.
  wav: string
  seconds: number
  sampleRate: number
  // Rendered by an OfflineAudioContext, as fast as it runs, instead of in
  // real time.
  offline: boolean
}>

export type Probe = Readonly<{
  fromMicrophone: (request: MicrophoneRequest) => Promise<Capture>
  fromBuffer: (request: BufferRequest) => Promise<Capture>
}>

declare global {
  interface Window {
    intoneProbe: Probe
  }
}
