# How far the live curve runs behind the voice

During a take the learner's curve draws as they speak, a moment behind their voice.
This page says how long that moment is, stage by stage, measured in a desktop browser against the latency budget in T226's report (section 4, "The latency budget"), and how it is measured.
`tests/e2e/live-curve.spec.ts` measures it on every CI run and fails when it passes 260 ms.

## The numbers

Measured on 2026-11-09 in Chromium 158 (Playwright 1.65's headless shell) on Linux, on an 11-core desktop machine under load from other work (load average 7 to 9), over 15 takes of the three synthetic voices.
The event timed is the end of the voice: its last sample louder than -46 dBFS, against the paint that first shows its last voiced frame.

| Stage                                        | The report's budget          | Measured                                                                                                      |
| -------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Microphone and OS input                      | About 10 to 30 ms on desktop | Not measured: the fake microphone hands its file straight to the browser, with no device or driver in the way |
| `AudioWorklet` block, batched to about 20 ms | 20 ms                        | 1 to 19 ms: how far the voice's end sat from the end of its 20 ms batch                                       |
| SwiftF0 lookahead                            | 176 ms                       | 138 to 181 ms from the voice's end until the audio the last voiced frame needs is in                          |
| SwiftF0 inference on a 20 ms chunk           | About 1 ms                   | 6 to 32 ms with resampling and the messages either way, below                                                 |
| Message to the main thread                   | Under 1 ms                   | In the line above                                                                                             |
| Next frame, then display                     | 17 to 33 ms                  | 0.5 to 12 ms to the paint; then up to 16.7 ms to the screen, which a page cannot time                         |
| **Total**                                    | **About 225 to 260 ms**      | **174 to 210 ms to the paint, median 185 ms**                                                                 |

With the screen's next refresh (up to 16.7 ms) and a microphone in the report's 10 to 30 ms, the voice-to-glass delay comes to about 185 to 257 ms on this machine: inside the report's estimate, about a quarter of a second.

What the stages show:

- **The lookahead is shorter than 176 ms after the voice's end.** SwiftF0 needs the 10 frames after a frame, 160 ms, and the frame's own 16 ms; but the last voiced frame ends before the audio falls quiet, since the voice's 25 ms fade loses confidence first, so part of that wait has passed when the voice ends.
  For speech that stops abruptly the wait is the full 176 ms less the batching.
- **Tracking takes 6 to 10 ms, or about 20 ms more.** The resampler down to 16 kHz holds back its last 2.5 ms for its filter, and when the audio a frame needs falls in that 2.5 ms, the frame waits for the next 20 ms batch.
  Inference on one window (the new frames with 11 frames before and 10 after) and the two messages take the rest.
- **The paint is the next animation frame** that has new frames to draw; the canvas paints only when something changed.

Daniel judges whether this lag is acceptable by trying the live curve (ticket 21), and a faint fast tail is added only if not.

## How it is measured

The test plays each synthetic voice (`fixtures/synthetic/`, the voice ending 1.9 s into the file) through Chromium's fake microphone into the built app, records a take, and watches three points of the audio path from inside the page, all timed by the page's own clock (`performance.now()`):

1. **The batches.** Each batch the app hands to the tracker Worker is read before it is transferred, which finds the batch holding the voice's last loud sample and that sample's place in it.
   The audio thread posts a batch when its last sample is in, so the voice ended `(960 - place) / 48 000` seconds before that batch reached the main thread.
2. **The Worker's replies.** Each `Frames` message is timed as it arrives, which finds the take's last voiced frame and the moment it came back.
   The batch that completed the audio that frame needs, 11 frames of 256 samples at 16 kHz past its start, splits the wait into the lookahead and the tracking.
3. **The paints.** The live canvas writes on itself, at each paint, how many frames it has drawn and the newest voiced one (`data-drawn-frames`, `data-drawn-last-voiced`); a `MutationObserver` times each paint.

The total runs from the voice's end on the audio thread to the paint that shows its last voiced frame.
It leaves out what a page cannot see: the microphone and the operating system before the audio thread, and the compositor after the paint.
The test also checks that the live frames are the finished curve's frames, to 0.01 Hz, and that the canvas painted while the take recorded.

Run it with `npm run build`, then `npx playwright test tests/e2e/live-curve.spec.ts`; each take attaches its stages as `<voice>-delays.json`.

## From the take's end to its score

When the learner presses stop, the tracker Worker tracks the whole take and finds its features, and the Scorer scores it against the line; the score card then shows the match.
`tests/e2e/practice.spec.ts` times it inside the page, from the press of stop to the score's words in the panel's live region, by the page's own clock.

Measured on 2026-11-09 in the same Chromium on the same machine (load average 2), six takes of the bundled line in 玄野武宏's voice, three right and three with the fall moved: 50 to 53 ms.
That includes loading the score's own chunk, which the first take on a page fetches (`src/services/compare-take.ts`), and the score itself, under a millisecond for a line this short (`docs/score.md`, "Time to score").
The test fails above 2 s.

## The frame rate

`tests/e2e/frame-rate.spec.ts` records a 20 s take with the CPU slowed six times (`Emulation.setCPUThrottlingRate`) and times every animation frame: it must hold 58 frames a second or more, with at most 5 frames longer than 34 ms, and the curve must keep drawing to the end.
A long frame is one that misses more than one refresh; a frame that misses a single refresh lasts 33.3 ms and is not counted as long, but the 58 frames a second floor bounds those too, to about 40 in the 1,200.
Measured alone on the machine above, four runs held 60.00 frames a second with no frame over 16.8 ms, while the take kept the slowed main thread about 16% busy (4% of it script).
With five copies of the test running at once on the same machine, it dropped to 56 frames a second, so it runs in a Playwright project of its own, `frame-rate`, after every other end-to-end test.
`docs/upgrading.md` names it as the check every Foldkit upgrade runs.
