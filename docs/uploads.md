# Uploads: bringing your own audio

The learner brings a recording on `/upload`, by the file picker or by dropping it on the page.
It is cut into lines on the device, each line's native curve is found, and the clip, its lines and their curves are kept on the device; nothing is sent anywhere.
This file records what the browsers decode, how long a cut takes, and what the ten-minute cap costs in memory.
`AGENTS.md`, "Uploads", says where the code is.

## What happens to a file

1. The file's media type is read: one that names itself as something other than sound (text, an image, a PDF) is refused before it is read, and so is an empty file.
   Audio and video types, `application/ogg` (Firefox's name for an Ogg file), `application/octet-stream` and no type at all are tried.
2. Its length is read from its header by an audio element told to load only that (`preload="metadata"`).
   A clip over ten minutes is refused here, before it is decoded.
   A file the audio element cannot play is refused here too, since its lines would be played by one.
   When the header does not say how long it is, the length is checked once decoded.
3. It is decoded by the browser with an `OfflineAudioContext` at 16 kHz, its channels mixed to mono.
4. The clip Worker finds its speech with Silero VAD 6.2.3, cuts it into lines (`src/engine/cut/lines.ts`, below) and tracks each line with the take's own tracking on SwiftF0, with its spectral features for the score.
5. The file as it came, its lines and their curves are kept: the file in the origin private file system, the rest in IndexedDB.
   A line plays its stretch of that file, at the chosen listening speed, with its pitch kept.

The screen shows each step on one progress bar, and Stop ends the cut at once: the clip Worker is asked to close, stops at its next 32 ms window or line, frees both models and closes; it is terminated after two seconds if it has not.
Nothing of a stopped cut is kept.

## The cut

Speech starts where Silero VAD's probability reaches 0.5 and ends once it has stayed under 0.35 for 300 ms, the pause the report measured (report section 2).
Speech under 250 ms is left out; a line over 4 s is cut at its longest inner silence of at least 98 ms, or in the middle when it has none; a line under 1 s joins its nearer neighbour across a pause under 800 ms when the two together are no longer than 4 s.
Each line keeps 150 ms of the quiet before it and 200 ms after it, or half the pause to its neighbour when that is less.

### Results on the CC0 clips

On ticket 08's three LibriVox CC0 clips (`fixtures/real/`, one reader in a quiet room), the browser cut each into the same lines as `docs/cut-study.md`, which `npm run cut:study` writes from the same code under Node, line by line:

| Clip          | Length | Lines | Shortest | Median | Longest | Every line has a curve | Cut in Chromium, 2 runs | Under Node |
| ------------- | ------ | ----- | -------- | ------ | ------- | ---------------------- | ----------------------- | ---------- |
| `romandourou` | 59.5 s | 21    | 1.12 s   | 2.53 s | 3.93 s  | yes                    | 2.23 s, 2.19 s          | 1.61 s     |
| `gongitsune`  | 29.2 s | 10    | 1.73 s   | 2.49 s | 3.23 s  | yes                    | 1.53 s, 1.53 s          | 0.98 s     |
| `good-bye`    | 28.8 s | 9     | 1.63 s   | 3.07 s | 3.87 s  | yes                    | 1.57 s, 1.55 s          | 1.10 s     |

The lengths include each line's lead and tail.
The browser's times run from choosing the file to the clip's lines on screen: reading, decoding, cutting, tracking and keeping, measured on the development machine on 2026-11-10 (headless Chromium from Playwright 1.65, load average about 1).
The report's spike found 22 lines in the same 60 s reading with its 300 ms rule alone; the rules above give 21, all 1 to 4 s of speech.

A take of `gongitsune`'s line 1 in the reader's own voice, through Chromium's fake microphone, scored 89% (`tests/e2e/uploads.spec.ts`).

These are one reader of literary prose in a quiet room.
Real uploads will be harder: music under the voice gives a poor native curve, since SwiftF0 tracks any pitched sound, and nothing here separates voices from music (spec, "Out of Scope").
Each line is marked when its curve is weak, and its cut can be fixed on its level (below).

## Fixing the lines

A clip's level shows its waveform around the line selected, with every line's span over it, and the selected line's start and end as sliders: dragged by mouse, pen or touch, or stepped 10 ms by the arrow keys and 100 ms with Shift or the page keys, each saying its time to a screen reader.
A playhead, placed by a tap or the keys and moved by a play, is where a line is split; a line can be merged with either neighbour or deleted, and the last change undone once, after a reload too.
An edge two lines share, as a split leaves it, moves both.

A level opens with its line editor shut, so a level opened only to practise decodes nothing. Once the learner opens the editor, and while the level stays open with its audio on the device, a ManagedResource holds the clip Worker with the clip decoded once and kept in it (`ClipAnalyser.edit`); it sends back the waveform (a byte per 10 ms) and tracks the lines a change moves, with Silero VAD over half a second before each for its quality, exactly as the cut tracked them: a cut line's own span tracked again gives the same curve and features, byte for byte (`tests/tracker/cut.test.ts`).
Only the lines a change moves are tracked again; the change is written only if no other tab changed the clip meanwhile.
Holding the clip costs what decoding it costs at upload, each time the editor is opened (about 600 MB at its peak for ten minutes, above), and then the 16 kHz clip (38 MB at ten minutes) and the two models while the level is open.

A line's takes stay with it: a take keeps the curve it was scored against, so a line whose span changed keeps its earlier takes apart on its history page, and a line deleted or merged away keeps its takes, its page saying it is gone.

## Weak lines

Each tracked line's quality pairs its curve with Silero VAD's windows over it (`src/engine/cut/quality.ts`): the share of its speech with a confident pitch, and the share of its pauses, where no one speaks, that still have one.
A line with under 40% of its speech pitched is marked for low pitch confidence; one with a pitch through over half its pauses as likely music.
Each mark says its number in the line's row, and in the editor what it means for the match.
`docs/cut-study.md` measures both on the CC0 clips clean, under classroom noise and over a synthetic music bed, which is where the thresholds come from; real music under real speech has not been measured.

## Formats

`fixtures/formats/` holds the first 4 s of `gongitsune` in eleven formats; `tests/e2e/uploads.spec.ts` tries each in Chromium on every run, and the same files were tried by hand in Firefox.

| File          | Format              | Chromium (Playwright 1.65) | Firefox 159 (Playwright 1.65) |
| ------------- | ------------------- | -------------------------- | ----------------------------- |
| `pcm16.wav`   | WAV, 16-bit PCM     | cut                        | cut                           |
| `pcm24.wav`   | WAV, 24-bit PCM     | cut                        | cut                           |
| `float32.wav` | WAV, 32-bit float   | cut                        | cut                           |
| `mp3.mp3`     | MP3, 128 kbit/s     | cut                        | cut                           |
| `aac.m4a`     | M4A, AAC-LC         | cut                        | cut                           |
| `alac.m4a`    | M4A, Apple Lossless | refused: cannot play it    | refused: cannot play it       |
| `flac.flac`   | FLAC                | cut                        | cut                           |
| `vorbis.ogg`  | Ogg Vorbis          | cut                        | cut                           |
| `opus.ogg`    | Ogg Opus            | cut                        | cut                           |
| `opus.webm`   | WebM Opus           | cut                        | cut                           |
| `aiff.aiff`   | AIFF, 16-bit PCM    | refused: cannot play it    | refused: cannot play it       |

A refused file is named, with what to do: "alac.m4a could not be used. This browser cannot play it. Convert it to WAV, MP3 or M4A and try again."
Safari was not tried: there is no Safari on the development machine, and Playwright's WebKit is not installed there; ticket 23's phone check is where it is tried.
Its column may well differ from these two, since browsers ship different decoders.

The first Firefox run refused both Ogg files as "not an audio file": Firefox names them `application/ogg`, which the media-type check then refused.
The check now tries `application/ogg`, and a Story test holds it.

## Memory at the cap

Measured on the development machine in headless Chromium, as the renderer process's resident memory, which holds the page and its Workers (sampled every 100 ms, and its own high-water mark), on ten minutes of the `romandourou` reading looped:

| File                              | Renderer before | Peak (high-water) | During the cut | After  | Time to its lines |
| --------------------------------- | --------------- | ----------------- | -------------- | ------ | ----------------- |
| WAV, 48 kHz stereo 16-bit, 115 MB | 116 MB          | 744 MB            | about 400 MB   | 315 MB | 13.3 s            |
| MP3, 128 kbit/s stereo, 9.6 MB    | 118 MB          | 618 MB            | about 400 MB   | -      | 13.5 s            |

The peak comes in the first second, while the browser decodes: it holds the file's bytes, its own decode of them at the file's rate (stereo float at 48 kHz is 230 MB for ten minutes, the report's estimate), its resampling to 16 kHz, and the mono mix the Worker gets.
Through the cut the renderer holds about 400 MB: the clip at 16 kHz (38 MB), the two models in ONNX Runtime's WebAssembly memory, and each line's curve and features as it is tracked.
The WAV gave 212 lines, cut in 13.3 s, 45 times faster than the audio.

This is a desktop's figure; a phone may refuse well under it, and ticket 23's phone check measures it there.
Decoding a file in pieces, which would bring the peak down to about what the cut holds, needs a demuxer per format (WebCodecs decodes but does not demux), and is left until a phone shows the need.
