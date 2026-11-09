# The sounds part

Whether a speech model's features can give the score a sounds part (the vowels and consonants) that stays level across voices and drops for a changed mora, and what was done with the answer.
Daniel decided the sounds part joins the headline match once a model passes the bar below, and the headline stays pitch accent and timing while none does (report section 3, "The sounds part").

## The bar

This section was written and committed before any model was run on the fixtures, so the numbers below cannot have been chosen to suit a result.

### What is measured

- **The models:** Whisper-base's encoder, WavLM-Base+ and WavLM-Large, each as the quantised ONNX file the app would download, run by ONNX Runtime Web on one thread, as the app runs its other models.
- **The features:** each model's last hidden layer, the layer McIntosh and colleagues scored with, at the model's own 20 ms frames, over the recording's speech span (the score's own, `pitchTrack` in `src/score/track.ts`).
- **The sounds distance:** DTW between the native's and the take's frames, each pair costing the cosine distance between their features, in the score's own band (20% of the longer recording, at least 250 ms); the distance is the path's cost over its length, McIntosh and colleagues' normalised DTW distance.
- **The sounds part:** the distance put on the scale the timing part uses: the median distance of the clean right takes scores 1, the median distance of a take of other words (another phrase's right take) scores 0, clamped to 0 to 1.
  So the spread below is read on the same 0 to 1 scale as the other parts and the headline.
- **The data:** the VOICEVOX fixtures as the score's study reads them (`docs/score.md`, "The data"): each voice's clean right take of each phrase as the native, copied by each of the other seven voices, `right` and `mora-changed` (one mora's sound changed, every accent kept), clean, in room noise and through a phone's band: 504 right takes and 504 changed ones.

### What a model must reach

A model passes when all four hold.

1. **Level across voices.**
   For each native, phrase and condition, the seven other voices' right takes have a sounds part within 0.25 of each other at the median over natives, and within 0.55 at worst.
   That is the bound the pitch accent part is held to (`tests/score/fixtures.test.ts`), so a part that joins the headline varies with the voice no more than the part already there.
2. **A changed mora, in the same voice.**
   In at least 95% of pairs of the same native, take voice and condition, the right take's sounds part is above the mora-changed take's, in every phrase and condition.
3. **A changed mora, across voices.**
   For the same native and condition, the chance that a right take in any voice has a sounds part above a mora-changed take in any voice is at least 0.90 in every phrase in the clean condition, and at least 0.80 in room noise and through the phone's band.
   Under that, more than one pair in ten would be told apart by the voice rather than by the changed mora, and the part would add the learner's voice to the headline.
4. **It runs in the app.**
   In a Worker in desktop Chromium, on one thread, the model loads, and a 6 s take's features take at most 2 s, so the score still shows within a few seconds of the take's end.

### The aligner

Separately from the bar, each model's features are tried as the aligner in place of the 24 log mel bands of ticket 10 (`docs/score.md`, "The aligner"), with the numbers ticket 10 compared aligners by: the median and 90th percentile of the error at the labelled mora starts, and the chance a right take's pitch skill beats a wrong one's at 5, 8 and 19 morae, over the same 3,528 pairs.
A model's features replace the bands only if their 90th percentile error is lower and no phrase's chance is lower.

## The answer

No model passes the bar, so the score has no sounds part and the headline stays pitch accent and timing (`partWeights` in `src/score/constants.ts`, `SCORE_VERSION` unchanged at 1).
Every number below is in `docs/sounds-study.md`, which `npm run sounds:study` writes, or from `npm run sounds:bench`.

| Model                              | 1. Level across voices                                      | 2. A changed mora, same voice                            | 3. A changed mora, across voices                         | 4. A 6 s take in a Worker |
| ---------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | ------------------------- |
| Whisper-base's encoder (q4)        | Passes: spread 0.03 to 0.18 at the median, 0.23 at worst    | Fails: 0.97 to 1.00 at 5 and 8 morae, 0.81 to 0.90 at 19 | Fails: 0.89 to 0.98 at 5 and 8 morae, 0.62 to 0.69 at 19 | Fails: 2.27 s             |
| WavLM-Base+ (int8)                 | Fails: 0.82 and 1.00 at the median at 8 and 19 morae, clean | Fails: 0.54 to 0.85                                      | Fails: 0.47 to 0.74                                      | Passes: 1.02 s            |
| WavLM-Base+ (fp32), for comparison | Passes: 0.04 to 0.25 at the median, 0.35 at worst           | Fails: 0.57 to 0.96                                      | Fails: 0.58 to 0.81                                      | Fails: 2.19 s             |
| WavLM-Large (q4)                   | Fails: 0.34 at the median at 5 morae in room noise          | Fails: 0.69 to 0.98                                      | Fails: 0.519 to 0.855                                    | Fails: 5.9 s              |

- **One mora in 19 is too little.**
  At 19 morae a changed mora moves every model's distance less than another voice saying the phrase right does: even on the raw distance, before the scale clamps the closest takes to 1, a right take beats a changed one across voices only 0.50 to 0.70 of the time, whichever the model.
- **Whisper's encoder is the closest.**
  It is level across voices and tells a changed mora at 5 and 8 morae nearly as the bar asks (0.895 across voices at 5 morae clean, against 0.90), but not at 19, and it fails the time limit narrowly.
- **WavLM does worst on the shortest phrase**, especially in room noise (0.52 to 0.59 across voices at 5 morae), as McIntosh and colleagues found DTW over WavLM weaker on isolated words than on sentences.
- **The int8 WavLM-Base+ file breaks on some inputs.**
  On 20 of the 504 fixtures, all clean, its last layer collapses to nearly one vector (consecutive frames at a mean cosine similarity over 0.95, up to 0.999, where the fp32 file gives about 0.8 on the same fixtures), and halving or normalising the input does not stop it; the fp32 file of the same model, measured beside it for that reason, collapses on none, and nor do the other two models.
- **WavLM-Large's q4f16 file**, the 233.5 MB one the report sized, does not open in ONNX Runtime Web 1.31.1's WebAssembly (a float16 `Cast` whose type its graph does not expect), so the q4 file, 326.7 MB, was measured.

So the sounds part waits for a model that tells one mora in a long phrase from a voice; a lower layer of these models, a model fine-tuned for phonemes, or scoring each stretch of a line rather than its whole could each be measured against the same bar later.

## In the browser

Each model in a module Worker in desktop Chromium 158.0.8127.18 (Playwright's), on one thread, on Daniel's machine (11 cores, Linux), by `npm run sounds:bench`, three times:

| Model                       | Download | Session opens  | A 6 s take, first run | Each run after | Page's peak memory |
| --------------------------- | -------- | -------------- | --------------------- | -------------- | ------------------ |
| Whisper-base's encoder (q4) | 18.8 MB  | 0.19 to 0.20 s | 2.29 s                | 2.26 to 2.27 s | 425 to 446 MiB     |
| WavLM-Base+ (int8)          | 95.4 MB  | 0.30 s         | 1.10 s                | 1.02 s         | 574 to 579 MiB     |
| WavLM-Base+ (fp32)          | 377.9 MB | 0.50 to 0.59 s | 2.20 to 2.23 s        | 2.18 to 2.19 s | 1,590 to 1,593 MiB |
| WavLM-Large (q4)            | 326.7 MB | 0.91 to 0.98 s | 5.91 to 5.94 s        | 5.89 to 5.93 s | 1,405 to 1,407 MiB |

- **Download** is the file's size, which the learner's connection would fetch once; from the bench's own loopback server it took 35 to 300 ms, which says nothing of a real connection.
- **Peak memory** is the highest resident memory of the browser's renderer processes over the run, read from `/proc`; the page held 124 to 130 MiB before the model was fetched.
- **Whisper's encoder** always reads a 30 s window, so a take of any length costs it about 2.3 s; its log mel spectrogram is made beforehand and is not in the time.
  WavLM's time grows with the take: Base+ int8 runs at about a sixth of real time, Large at about real time.
- **The study's frames were made in Node** on the same ONNX Runtime Web WebAssembly (`npm run sounds:features`, 3 to 22 minutes a model on one thread), and the bench runs six of the fixtures in the Worker as well: every model's frames there equal Node's exactly.

## The aligner, answered

| Aligner                                    | Mora start error, median | p90   | Right beats wrong, 5 morae | 8 morae | 19 morae |
| ------------------------------------------ | ------------------------ | ----- | -------------------------- | ------- | -------- |
| 24 log mel bands (ticket 10's, chosen)     | 11 ms                    | 32 ms | 0.993                      | 1.000   | 0.968    |
| Whisper-base's encoder (q4)                | 11 ms                    | 27 ms | 1.000                      | 1.000   | 0.980    |
| WavLM-Base+ (int8)                         | 11 ms                    | 48 ms | 0.991                      | 0.977   | 0.920    |
| WavLM-Base+ (fp32)                         | 11 ms                    | 27 ms | 0.997                      | 1.000   | 0.980    |
| WavLM-Large (q4)                           | 11 ms                    | 27 ms | 0.998                      | 1.000   | 0.980    |
| The labelled mora boundaries (the ceiling) | 5 ms                     | 11 ms | 1.000                      | 1.000   | 0.983    |

Whisper's encoder, WavLM-Base+ in fp32 and WavLM-Large line takes up across voices better than the bands: 5 ms closer at the 90th percentile, and a right take beats a wrong one at 19 morae 0.980 of the time against 0.968, near the labelled boundaries' 0.983.
The int8 WavLM-Base+ file does worse, from the fixtures it collapses on.

They go through the `Aligner` interface as they are: `onCurveFrames` (`src/score/features.ts`) puts a model's frames on the curve's own frames, which `normaliseFeatures` and `dtwAligner` then take as they take the bands, and the study lines the fixtures up that way.
The app's `chosenAligner` still reads the bands, since the bar's rule for the aligner is needed but not enough:

- none of the models is on the device for a take: Whisper-base comes only once the learner agrees to transcription (ticket 16), and WavLM never, so the score would need a download first, or would mean something different with one than without;
- each take would wait 2.3 to 5.9 s for the model's frames, where the whole score now shows about 50 ms after the take ends (`docs/latency.md`);
- the gain is 5 ms at the 90th percentile and 0.012 at 19 morae.

Once transcription keeps Whisper-base's encoder on the device, aligning by its frames when they are there is the change to weigh, with a `SCORE_VERSION` bump, since it moves scores.

## The licences, read at source

| Model                       | The weights' licence             | Where it says so                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Whisper-base                | MIT, "Copyright (c) 2022 OpenAI" | OpenAI's repository: "Whisper's code and model weights are released under the MIT License" (`README.md` and `LICENSE` at commit `86098128c0b4f24f0e2aa2994de830614b474227`); the Hugging Face cards of `openai/whisper-base` and of the ONNX conversion `onnx-community/whisper-base` (commit `27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c`) say Apache 2.0                                                                             |
| WavLM-Base+ and WavLM-Large | CC BY-SA 3.0                     | Microsoft's model cards, `microsoft/wavlm-base-plus` and `microsoft/wavlm-large`, name "the official license" as UniSpeech's `LICENSE` (Attribution-ShareAlike 3.0 Unported, at commit `6112826ac13a4327f4c9a7afa2a505e35b763514`); the code in `microsoft/unilm` is MIT; the ONNX conversions `Xenova/wavlm-base-plus` and `onnx-community/wavlm-large-ONNX` state no licence of their own, and the second repeats Microsoft's line |

Since no model ships, nothing is credited on a `/credits` screen and no converted copy is kept.
A WavLM file served later would be credited to Microsoft under CC BY-SA 3.0, with a converted copy kept under the same licence; Whisper's under MIT, with OpenAI's copyright line.

## Running it again

- `npm run sounds:features` runs each model on every voice fixture and keeps the frames in the git-ignored `.cache/sounds/features/` (670 MB for the four files); `--model <id>` runs one and `--shard i/n` splits the fixtures between processes.
  The models are fetched into `.cache/models/` by size and SHA-256, at the pinned revisions in `tests/support/sound-models.ts`.
- `npm run sounds:study` then writes `docs/sounds-study.md`; `tests/scripts/sounds-study.test.ts` remakes it and checks every model still fails, where the frames are all there, and is skipped where they are not, as in CI.
- `npm run sounds:bench` prints the browser's numbers above, one line a model.
