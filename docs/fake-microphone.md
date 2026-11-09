# The fake microphone

The end-to-end tests drive the app's real audio path with Chromium's fake microphone, which plays a known WAV through `getUserMedia`.
This page says how faithfully that audio reaches the app's capture worklet, and what a test may rely on.
`tests/e2e/fake-microphone.spec.ts` measures it on every CI run, and every number here comes from its attachments.

## Verdict

The fake microphone is good enough for the app's end-to-end tests, which read curves, levels and timings, so the tests use it and no buffer-fed test build exists.
It delivers the file's samples with no processing, resampled through 44.1 kHz, at a gain within 0.002% of 1.
A pitch estimate of what arrives is as close to the known curve as the same estimate of the source.
But it is not sample-exact, and on a busy machine it slips: now and then a 10 ms device buffer arrives late, the capture gains 10 ms, and everything after it sits 10 ms later.
A test that needs the exact samples drives the capture worklet with the buffer source instead (below), as these tests do.

What a test on the fake microphone must allow for:

- the voice starts 32 ms into the capture, or a whole number of 10 ms device buffers later, up to 53 ms in the runs seen;
- each slip adds 10 ms, to within 0.05 ms, and most takes have none;
- up to two frames near a slip read no pitch, and the curve after it is 10 ms late;
- 16-bit quantisation and the resampler, about 89 dB below the voice.

## How it is measured

- **The voices.** `npm run fixtures:synthetic` writes `fixtures/synthetic/{low,middle,high}.wav` (48 kHz, 16-bit, mono, 2.3 s) and their labels, from a seed and no corpus data: a glottal pulse train whose frequency follows a known F0 curve, through vowel formant filters, with a little seeded breath noise.
  The ranges are 80 to 125 Hz, 144 to 225 Hz and 256 to 400 Hz, with half a second of silence first.
  `tests/scripts/synthetic-voices.test.ts` regenerates them and fails on any byte of difference.
- **The capture worklet.** `src/engine/worklet/capture-processor.ts` copies its one input into a ring buffer allocated once and posts 20 ms batches (960 samples at 48 kHz); an input with nothing connected counts as silence, so the batches keep time with the context.
  `src/engine/worklet/capture.ts` loads it and makes its node, mixed down to mono.
- **The probe.** `tests/e2e/probe/` is a test-only page, built and served apart from the app (never in `dist/`) under the app's Content Security Policy, which drives that worklet.
  It makes the `AudioContext` at 48 kHz and the capture node, waits for the first batch, then opens the microphone with echo cancellation, noise suppression and auto gain off and connects it, as the app should.
- **The browser.** Playwright's Chromium, one launch per take, with `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-audio-capture=<wav>%noloop` and `--autoplay-policy=no-user-gesture-required`.
- **The comparison.** `tests/support/audio-compare.ts` places the source in the capture by its onset, then follows it in 20 ms segments, so a slip shows as a slip rather than as noise over everything after it, then finds each stretch's fractional delay and fits one gain over them all.
  The SNR is the signal against everything else over the stretches between slips.
  `tests/support/pitch.ts` is a plain YIN estimate, never the app's tracker; it reads a steady pitch within a cent, and up to about 16 cents on the voices' fastest glides.

## Results

### Does the audio arrive unaltered?

|                      | Fake microphone                                                                                 | Buffer source                                               |
| -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Track settings       | 44.1 kHz, 2 channels, 16-bit, latency 10 ms, all three processing constraints read back `false` | none: no device                                             |
| Rate                 | Resampled from the file's rate to 44.1 kHz, then to the context's 48 kHz                        | The file's own, at the context's rate                       |
| Gain                 | 1.00002                                                                                         | 1, exactly                                                  |
| Signal over the rest | 89 to 90 dB for the three voices                                                                | Exact: every sample equal                                   |
| Slips                | 0 in these three takes; see the twenty runs                                                     | None: the source plays inside the same graph as the worklet |

With the browser's processing left on (plain `audio: true`), the track reads back echo cancellation, noise suppression and auto gain all `true`, at 48 kHz mono, and the audio is altered throughout: 2.4 dB of signal over the rest, at a gain of 1.06.
The app must ask for all three off.

### How far is a pitch estimate from the known curve?

Over the 75 voiced frames at least 50 ms from a voicing edge, in cents:

| Voice  | Received: median, 95th percentile, largest, frames missing | The source itself |
| ------ | ---------------------------------------------------------- | ----------------- |
| Low    | 2.9, 7.7, 12.1, 1                                          | 2.9, 7.7, 12.0, 1 |
| Middle | 1.5, 7.2, 16.2, 0                                          | 1.5, 7.2, 16.2, 0 |
| High   | 1.4, 8.5, 16.5, 0                                          | 1.4, 8.5, 16.4, 0 |

What is left is the estimate's own error on a glide; the fake microphone adds less than 0.1 cent.
A slip inside voice loses up to two frames near it.
A test that reads the curve by time without allowing for the slip finds the rest of it 10 ms late, up to about 40 cents off on the fastest glides.

### When does the voice start?

The voice's first sample lands 32.1 ms after the capture's first sample in most takes: the probe opens the microphone after the worklet's first batch, 20 ms in, and the file's audio reaches the worklet about 12 ms after that.
Others start at 32.7 ms, or one or two 10 ms device buffers later than either: 42.1, 42.7, 43.4, 52.1 and 53.4 ms were seen.
The file starts playing at `getUserMedia`, not when a source is connected, so the worklet must be running first: before the probe waited for the first batch, a take on a busy machine lost 158 ms of the file's start.

### Twenty runs

The middle voice twenty times, each in a fresh browser, at a load average of 13 to 14 on a shared machine:

| Measure                  | Lowest   | Highest  | Spread | Spread allowed       |
| ------------------------ | -------- | -------- | ------ | -------------------- |
| Start, ms                | 32.06    | 32.73    | 0.67   | 35                   |
| Slips                    | 0        | 1        | 1      | any, each 10 ms      |
| Gain                     | 1.000019 | 1.000019 | 8e-9   | 1e-4                 |
| Signal over the rest, dB | 89.43    | 89.46    | 0.03   | 3, and each above 70 |
| Pitch median, cents      | 1.51     | 1.67     | 0.16   | 0.5                  |
| Pitch largest, cents     | 16.22    | 16.22    | 0      | 2                    |

One run of the twenty slipped; a second run of the twenty, at the same load, had no slip and stayed within the spreads above.
Over the whole spec, 6 of its 34 microphone takes slipped in the first run and 3 in the second, and 2 takes in 10 slipped at a load average of 17.
Every slip seen added 10 ms; none lost any.

### Which WAV formats work

The middle voice, written in each format, with the same checks (gain within 1%, more than 35 dB of signal over the rest, a pitch median under 3 cents):

| Format                                          | Arrives                                                                                        | Signal over the rest            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| 48 kHz 16-bit mono                              | Yes                                                                                            | 89 dB                           |
| 48 kHz 16-bit stereo                            | Yes, mixed to mono by the capture node                                                         | 89 dB                           |
| 8 kHz 16-bit mono                               | Yes, but its top band, above about 3.5 kHz, is cut on the way, so it is compared below 3.5 kHz | 53 dB below 3.5 kHz             |
| 16 kHz, 22.05 kHz, 44.1 kHz, 96 kHz 16-bit mono | Yes                                                                                            | 88 to 93 dB                     |
| 48 kHz 8-bit mono                               | Yes                                                                                            | 42 dB, 8-bit quantisation's own |
| 48 kHz 24-bit mono                              | No: it arrives as silence                                                                      |                                 |
| 48 kHz 32-bit integer mono                      | Yes                                                                                            | 104 dB                          |
| 48 kHz 32-bit float mono                        | Yes                                                                                            | 104 dB                          |

Write test audio as 48 kHz 16-bit mono, as the fixtures are; never 24-bit.

## The buffer source

`src/engine/audio/buffer-source.ts` plays decoded audio into the same capture worklet: `audioBufferOf` makes an `AudioBuffer` from a decoded WAV and `playBuffer` starts it into a node.
Rendered by an `OfflineAudioContext`, the worklet's batches hold the source sample for sample, from the first sample, for all three voices.
In a running `AudioContext` they hold it sample for sample too, 10.7 ms late: the context had rendered that much into the worklet before the source started.
Tests that need audio through the worklet use it, with no browser microphone.
The Microphone service's test layer, `Microphone.layerBuffer(wav)` in `src/services/microphone.ts`, plays through it too, in an AudioContext at the recording's own rate, and the probe's test of it finds the batches equal to the source, sample for sample.

## Running it

`npm run test:e2e` runs this spec with the rest; `npx playwright test tests/e2e/fake-microphone.spec.ts` runs it alone once `npm run build` has built the app, since Playwright's web server builds only the probe.
It takes about three minutes, most of it the twenty runs and the format matrix, each a fresh browser.
The probe is served on the port after the app's (`E2E_PORT + 1`).
CI runs it in its end-to-end step, and uploads the Playwright report, with the attachments, when a test fails.
