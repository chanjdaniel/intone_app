# Transcription on the device

Intone writes out the text of a clip the learner brings, on their own device, with OpenAI's Whisper, once they agree to its download.
The text is for reading: no score reads it, practice never waits for it, and the learner can edit it or paste their own.
This file says how it works, what was chosen and why, and what it measured; `docs/transcription-study.md` holds the study's numbers, written by `npm run text:study`.

## What the learner sees

- When an upload's lines open, a dialog asks first: "Download the text model?", with "Intone can write out each line's text, on this device. It needs a one-time download of 75 MB, which the browser keeps. Your clip never leaves this device.", a choice "Larger model, better text (whisper-small, 226 MB)", and "Download 75 MB" (the size following the choice) or "Not now".
  The spec's wording said 73 MB, the two model files alone; the dialog adds the five small files Transformers.js loads with them, read from `models.json`, so the size it names is what downloads.
- "Not now" is kept with the settings, so a later upload does not ask again; `/settings` ("Text for your lines") offers the download again, and the level's "Write out the text" asks again.
  Declining leaves practice as it was: `tests/e2e/uploads.spec.ts` says "Not now" and then practises a line of the clip to a score, with no request for a model file.
- Agreeing keeps the model chosen, and later uploads are written out at once with it.
  The job runs in the background, on any screen: the level shows its step ("Downloading the text model: 30 of 75 MB.", "Writing out the text: part 2 of 4.") with a bar and a Stop, and says "It runs in the background: practise any line meanwhile."
- Each line of the level is then named by its text, with its number and times beside it, and its practice screen is titled by it.
  Under each row, "Edit the text" (or "Add its text") opens a field for that line; "Paste your own text" takes one line of text for each line of the clip, in order, and refuses a count that differs, saying both counts.
  The learner's own text stands over the transcript's, and survives writing the clip out again.
- `/credits` names every model the app ships, with its licence and source, read from `models.json` through the build, and the bundled recording's voice; `NOTICES.md` lists the same models with their files.

## The models

| Model           | Files from                                 | Revision                                   | Download      |
| --------------- | ------------------------------------------ | ------------------------------------------ | ------------- |
| `whisper-base`  | `onnx-community/whisper-base_timestamped`  | `608c49e61301901684bc36cac8f74b95ff6b5a8e` | 75,253,316 B  |
| `whisper-small` | `onnx-community/whisper-small_timestamped` | `65caa70f294b46e1c33ff820aae6b16d048ab818` | 225,743,849 B |

Each is seven files: `config.json`, `generation_config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/encoder_model_q4.onnx` and `onnx/decoder_model_merged_int8.onnx`, the quantisations T226's spike ran.
They are exactly the files Transformers.js 4.3.2 requested in Chromium for an `automatic-speech-recognition` pipeline at those dtypes, seen in the page's requests, and `tests/build/models.test.ts` pins the list.
OpenAI's code and weights are MIT (`docs/sounds.md`, "Licences").

`whisper-small` comes from the timestamped export of the same weights, not from `onnx-community/whisper-small`, whose decoder ticket 05 first listed: that export has no cross-attention outputs, and asked for word timestamps Transformers.js fails with "Model outputs must contain cross attentions to extract timestamps"; with segment timestamps alone it gave four chunks of 4 to 10 s for the 29 s clip, longer than a line, so they could not be matched to lines.

## How it runs

- `src/services/transcriber.ts` decodes the clip at 16 kHz with the browser's decoder, as the cut does, cuts it into the windows Whisper reads, and hands it to the text Worker, `src/workers/text.worker.ts`, transferred.
- The Worker fetches the model's files itself into Transformers.js's own browser cache, the Cache API store `intone-text-models` (`src/workers/text-model-cache.ts`), under the key Transformers.js looks a local model's file up by, reporting the bytes against the sizes `models.json` gives and checking each file's length.
  Transformers.js, given a progress callback, first fetches every file once more to learn its size, and asks for `onnx/encoder_model_quantized.onnx`, which is not listed, so a 404 reaches the console; without the callback it does neither, and finds every file in its cache.
- Whisper is opened through Transformers.js with remote models off, local models on and its local model path on the app's `/models/`, each model loaded by `<id>/<version>`, its directory (`src/workers/whisper-session.ts`), so every request is for the app's own origin; the model's files are served with `Cache-Control: immutable` like every model (`docs/deploying.md`).
- Transformers.js pins its own ONNX Runtime, a 1.31.0 development build, and loads its `asyncify` WebAssembly, which runs WebGPU as well as the CPU; the build serves those two files from `/ort/1.31.0-dev.20260914-8d85527a0/` (`build/onnx-runtime.ts`).
  Its WebAssembly cache is off: on, it loads ONNX Runtime's loader from a `blob:` URL, which the Content Security Policy refuses.
- Stop ends the job's Stream: the Worker is asked to close, stops a download at once and a transcription at its next window, disposes Whisper's sessions, and is terminated after two seconds anyway.
- Clearing all data deletes the Cache API store too.

### Windows and pieces

Whisper's encoder reads 30 s whatever it is given, so the clip is read in windows of at most 30 s (`src/engine/text/windows.ts`), from 0.2 s before its first line to 0.2 s after its last, each window closing in the middle of a pause between two lines, never inside one.
A single phrase read alone costs about 3 s on `whisper-base` and comes out worse (方向を for 方こそ, report section 2), which is why the whole clip is read and the text matched to lines afterwards.

Transformers.js 4.3.2 groups a Japanese transcript's word timestamps on spaces, as for English: its pipeline drops the language token before it groups the words, so the language it groups for is unknown, and the "words" it gave for the 29 s clip were whole phrases of up to 6.3 s.
The Worker therefore runs the model's `generate` itself with token timestamps, as the pipeline does, and makes its own pieces (`src/engine/text/pieces.ts`): the shortest run of tokens that decodes to whole characters, from its first token's time to the next piece's, but no longer than 0.6 s, so a pause after a word is not counted as its.

### Matching to lines

Each piece goes to the line its middle falls in, or, in a pause, to the nearer line within half a second; further from any line it is left out (`src/engine/text/match.ts`).
A line's text is its pieces in order, without the punctuation that closed the line before it and without the spaces Whisper's tokens put between Japanese words.
The transcript is kept with the clip as pieces (`ClipEntry.transcript`) and matched each time it is read, so a line the learner moves, splits or merges gets the words of its new span; a moved line keeps the text the learner gave it, and a split or merged one takes the transcript's.

## WebGPU and the CPU

| Run on the 29 s clip, `whisper-base`, T226's spike page       | Reading    |
| ------------------------------------------------------------- | ---------- |
| Both sessions on the CPU (WebAssembly, one thread)            | 17 s       |
| Both on WebGPU, the q4 encoder and int8 decoder               | 56 to 65 s |
| Both on WebGPU, the q4 encoder and a q4 decoder (124 MB more) | 5.7 s      |
| The q4 encoder on WebGPU, the int8 decoder on the CPU         | 4.9 s      |

Measured on 2026-11-13 on Daniel's machine, an NVIDIA GeForce RTX 3070 (Ampere) through Chromium's Vulkan WebGPU, in a headed window: headless Chromium reaches only SwiftShader, a software adapter, whatever the flags.
The int8 decoder is slower on WebGPU than on the CPU, so the app runs the encoder on WebGPU and the decoder on the CPU, from the same files: the download is the same either way, and the text came out the same as on the CPU.
The Worker uses WebGPU when a GPU answers that is not a software one, and falls back to the CPU when there is none or its sessions fail to open; the transcript records which ran.
The tests run on the CPU, in headless Chromium; `npm run text:study -- --run` runs both, WebGPU in a headed window.

STUDY-NUMBERS

## Nothing leaves the device

`tests/e2e/transcription.spec.ts` uploads `fixtures/real/gongitsune.wav` to the built app, agrees, and waits for the text, then checks that every request went to the app's own origin, every one a `GET` with no body, and that each of `whisper-base`'s seven files was requested once and nothing of `whisper-small`.
After a reload it writes the clip out again and sees no request for any model file, and the seven files in the Cache API store.

## What it does not do

- Kana readings are ticket 17's.
- A pack's lines take their text from its manifest, and the bundled lines have theirs; only uploads are written out.
- An interrupted download is not resumed; the files already in the cache are kept, and the rest fetched again.
- Nothing has been measured on a phone, whose speed and memory for Whisper are the largest unknown (report section 2).
