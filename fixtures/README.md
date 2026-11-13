# Test fixtures

Generated test audio and what is known about it: for the synthetic and VOICEVOX files, the intended curve, the accent and the mora boundaries, so the tracker and the score can be tested against them; for the real clips, their source and licence, for tracking and cutting real speech.
Nothing here is hand-edited, and nothing here is real accuracy on learners (see "How synthetic speech differs from a learner's" below).

| Folder        | What it holds                                                                                                                                       | Written by                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `synthetic/`  | Three formant-synthesised voices with an exactly known F0, for the fake microphone (`docs/fake-microphone.md`)                                      | `npm run fixtures:synthetic`  |
| `voices/`     | Three Japanese phrases in eight VOICEVOX voices, right and wrong, slower, faster and uneven, each clean, in room noise and through a phone band     | `npm run fixtures:voices`     |
| `real/`       | Three stretches of LibriVox's CC0 Japanese readings, real speech for tracking and cutting                                                           | `npm run fixtures:voices`     |
| `noise/`      | The room noise mixed into `voices/`, cut from a CC BY 4.0 recording                                                                                 | `npm run fixtures:voices`     |
| `formats/`    | The first 4 s of `real/gongitsune.wav` in eleven audio formats, for what a browser decodes from an upload (`docs/uploads.md`)                       | `npm run fixtures:formats`    |
| `local-pack/` | An example local pack for the tests: two phrases of `voices/` and the first 8 s of `real/gongitsune.wav`, with a `pack.json` (`docs/local-pack.md`) | `npm run fixtures:local-pack` |
| `tracked/`    | Every WAV above but `formats/` and `local-pack/` tracked and featured as the app does it: its curve and spectral features (`docs/score.md`)         | `npm run fixtures:tracked`    |

## Making them

`npm run fixtures:voices` makes everything in `voices/`, `real/` and `noise/` in four stages, the same bytes every run:

1. `noise`: fetches the room noise recording, checks its SHA-1, mixes it to mono and resamples it to 24 kHz.
2. `real`: fetches each LibriVox chapter, checks its SHA-1, decodes it with ffmpeg and cuts the clip at whole samples.
3. `voices`: has VOICEVOX CORE make each phrase's AudioQuery from its kana, sets its mora pitches from the accent (below), edits it for the variant, synthesises it on one CPU thread, and labels it from the query.
4. `derived`: makes the room and phone versions of every clean VOICEVOX fixture, and measures each voice's pitch span into `voices/voices.json`, in Node alone.

The first three need VOICEVOX CORE, ffmpeg and the network once (downloads are cached in the git-ignored `.cache/`).
Set VOICEVOX CORE up once with `npm run fixtures:voices-setup` (Linux x64): it installs the Python binding (VOICEVOX CORE 0.17.1, MIT, pinned by hash) into the git-ignored `.venv/`, and runs VOICEVOX's own downloader, pinned by hash, for VOICEVOX ONNX Runtime 1.17.3, the Open JTalk dictionary and the voice models (voicevox_vvm 0.17.1).
The downloader asks the person running it to agree to the VOICEVOX ONNX Runtime terms and the VOICEVOX voice model terms; the script never answers for you.

`tests/scripts/voice-fixtures.test.ts` checks them:

- in CI and everywhere, it remakes the `derived` stage from the committed sources and fails on any byte of difference, and checks each clean fixture's length, mora boundaries, accents and variants against its labels;
- where VOICEVOX CORE is set up, it remakes all four stages and fails on any byte of difference; CI has no VOICEVOX CORE, since setting it up needs the terms agreed, so there the test says it is skipped.

The audio is committed, since every licence below allows it.

`npm run fixtures:tracked` (`scripts/tracked-fixtures.ts`) writes `tracked/<the WAV's path>.bin` for every WAV here: the WAV's first channel resampled to 16 kHz, tracked by the take's own engine on SwiftF0 (`src/engine/pitch/take.ts`) and featured by `src/engine/features/spectral.ts`, in Node.
Each file is a line of JSON (the analysis, the frames, the feature options) and then the curve's pitch, confidence and level and the features, as little-endian float32; `tests/support/tracked-fixtures.ts` reads and writes them.
`tests/scripts/tracked-fixtures.test.ts` remakes them all on the real model and fails on any byte of difference, so rerun the script after changing the tracker, the features or a WAV.

`npm run fixtures:formats` (`scripts/format-fixtures.ts`) writes `formats/`: the first 4 s of `real/gongitsune.wav`, stereo at 44.1 kHz (Opus at 48 kHz, its own rate), in each format `formats/formats.json` lists, encoded by ffmpeg n9.0.2 with no metadata, so a remake is the same bytes.
The encoders' output can change with ffmpeg's version, so the script refuses any other version, and `tests/scripts/format-fixtures.test.ts` remakes the files only where that version is installed; everywhere it checks that every listed file is there.
They are the CC0 recording, so the licence below covers them.

## The VOICEVOX fixtures

`voices/<phrase>/<voice>/<variant>[.room|.phone].wav`, each a 24 kHz 16-bit mono WAV, VOICEVOX's own rate, which the fake microphone plays faithfully (`docs/fake-microphone.md`), beside its labels, `<same name>.json`.
`tests/support/voice-fixture-set.ts` lists the phrases, variants and voices, and `tests/support/voice-fixtures.ts` makes and labels them.

### Phrases

Each phrase is written in VOICEVOX's kana notation, with the accent set by hand rather than guessed from the text, so the right accent is the Tokyo accent as dictionaries give it.

VOICEVOX predicts each mora's pitch from that accent, but softly: on these phrases its atamadaka often puts the second mora above the first, and a moved or lost fall changes a mora by only a semitone or two.
So each fixture's mora pitches are set from its kana's accent in the Tokyo pattern instead (`accentPitches` in `tests/support/voice-fixtures.ts`), between the voice's own low and high levels (the 10th and 90th percentile of VOICEVOX's predictions for its right accents):

- a phrase that falls after its first mora starts high and is low after it;
- any other starts halfway up, is high up to its fall and low after it, or high to its end when it does not fall;
- each fall shrinks the span above the low level to 0.7 of what it was for the phrases after it (downstep), and a pause restores it;
- the pitch declines a little, mora by mora.

The voice, its timbre and its timing are VOICEVOX's; the pitch targets are this pattern's.
`tests/tracker/voice-fixtures.test.ts` tracks every voice's right and fall-lost fixtures with the app's tracker on the real SwiftF0 model, and checks each right fall drops by more than a semitone and each lost one holds within a semitone and a half, at least 2 semitones less than the right one.

| Phrase                                           | Morae | Right accent                                      | Fall moved       | Fall lost       | Mora changed |
| ------------------------------------------------ | ----- | ------------------------------------------------- | ---------------- | --------------- | ------------ |
| `ame-ga-suki`: 雨が好き                          | 5     | あ↓めが すき↓                                     | あめ↓が          | あめが, as 飴が | め said ね   |
| `hashi-o-watarimasu`: 橋を渡ります               | 8     | はし↓を わたりま↓す                               | は↓しを, as 箸を | はしを, as 端を | し said す   |
| `kyou-wa-eki-de`: 今日は駅で古い友達に会いました | 19    | きょ↓うは、え↓きで ふる↓い ともだちに あいま↓した | えき↓で          | えきで          | だ said ら   |

雨が好き in 冥鳴ひまり, `voices/ame-ga-suki/meimei-himari/right.wav`, is the app's bundled line, served with its credit (`CREDITS.md`).
Each phrase has a devoiced mora: す in すき, す in ます, し in ました.

### Variants

| Variant            | What it is                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `right`            | The right accent, at VOICEVOX's own timing                                                                                              |
| `fall-moved`       | One accent phrase's fall moved to another mora                                                                                          |
| `fall-lost`        | One accent phrase that should fall does not                                                                                             |
| `mora-changed`     | One mora's sound changed, every accent kept, for the sounds study (`docs/sounds.md`)                                                    |
| `slower`, `faster` | The right accent at 0.8 and 1.25 times VOICEVOX's speed                                                                                 |
| `uneven`           | The right accent with about a third of the morae's vowels held 1.6 times as long and about a quarter clipped to 0.6, seeded per fixture |

Each is also written in two conditions:

- `.room`: the noise in `noise/` mixed in, 20 dB under the speech (measured over the speech), from a seeded place in the recording;
- `.phone`: a telephone band, fourth-order Butterworth high-pass at 300 Hz and low-pass at 3400 Hz, run forward as a line is.

### Labels

Every sample position is at 24 kHz and exact: VOICEVOX turns each phoneme's length into whole 93.75 Hz frames of 256 samples, and the labels follow its own arithmetic (`tests/support/voicevox-query.ts`).

- `phrase`, `voice`, `variant`, `condition`, `kana` (as synthesised), `wrong` (what is wrong, or `null`), `speedScale`.
- `samples`, `durationSeconds`, `speechStartSample`, `speechEndSample`: about 0.3 s of silence comes before and after the speech.
- `accentPhrases`: each one's kana, mora count, VOICEVOX's `accent` (its last high mora), `fallAfter` (the mora the pitch falls after, or `null` when it does not fall inside the phrase), `rightFallAfter` (the same for the right accent) and `pauseAfter`.
- `morae`: each one's text, accent phrase, `devoiced`, `changed` (its sound differs from the right one), `vowelLengthScale`, `startSample`, `vowelSample` and `endSample`, and `targetHz`, the pitch VOICEVOX was given for it (`null` when devoiced).
  `targetHz` is a step per mora; the voice glides between them, so it is the intended contour, not a measured F0.
- `noise` (source, SNR, offset, gain) and `band` (edges, order) for the room and phone versions.

### Voices

`voices/voices.json` holds each voice's credit, terms page and pitch span, measured on its right-accent fixtures with the plain YIN estimate in `tests/support/pitch.ts`, never the app's tracker, over the frames it reads (60% of the frames in the right fixtures' voiced vowels, since VOICEVOX's voice is less periodic over YIN's 25 ms window than a recorded one): the median F0, and the 5th to 95th percentile and its width in semitones.

| Voice                           | Style        | Median | 5th to 95th percentile | Span           |
| ------------------------------- | ------------ | ------ | ---------------------- | -------------- |
| 四国めたん (`shikoku-metan`)    | 2, ノーマル  | 270 Hz | 239 to 330 Hz          | 5.6 semitones  |
| ずんだもん (`zundamon`)         | 3, ノーマル  | 311 Hz | 274 to 402 Hz          | 6.6 semitones  |
| 九州そら (`kyushu-sora`)        | 16, ノーマル | 233 Hz | 186 to 350 Hz          | 11.0 semitones |
| 冥鳴ひまり (`meimei-himari`)    | 14, ノーマル | 223 Hz | 191 to 289 Hz          | 7.2 semitones  |
| 中国うさぎ (`chugoku-usagi`)    | 61, ノーマル | 219 Hz | 195 to 264 Hz          | 5.3 semitones  |
| 玄野武宏 (`kurono-takehiro`)    | 11, ノーマル | 119 Hz | 104 to 168 Hz          | 8.4 semitones  |
| 剣崎雌雄 (`kenzaki-mesuo`)      | 21, ノーマル | 126 Hz | 98 to 187 Hz           | 11.1 semitones |
| 白上虎太郎 (`shirakami-kotaro`) | 12, ふつう   | 168 Hz | 118 to 228 Hz          | 11.4 semitones |

So the set runs from two low voices (玄野武宏 and 剣崎雌雄, medians about 120 Hz) to a high one (ずんだもん, 311 Hz), and from narrow spans (中国うさぎ and 四国めたん, about 5.5 semitones) to wide ones (九州そら, 剣崎雌雄 and 白上虎太郎, about 11).

## Licences and credits

### VOICEVOX

VOICEVOX CORE is MIT.
The VOICEVOX voice model terms and the VOICEVOX ONNX Runtime terms (the same text, read in the downloader's prompt and in `TERMS.txt` of voicevox_vvm 0.17.1) allow use commercial or not and redistribution inside an application, require a credit that VOICEVOX was used, bind the audio to each voice's own terms, and require anyone the audio is passed on to to follow those same two conditions; they forbid decompiling or reverse engineering, and acts that harm the makers or others or offend public order.

Each voice's own terms, read at source on 2026-11-09:

| Voice                                        | Credit                                                                           | Terms                                                              | What they say about this use                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 四国めたん, ずんだもん, 九州そら, 中国うさぎ | VOICEVOX:四国めたん, VOICEVOX:ずんだもん, VOICEVOX:九州そら, VOICEVOX:中国うさぎ | [東北ずん子 project](https://zunko.jp/con_ongen_kiyaku.html)       | Commercial or not with the credit; no rule on distributing the audio; forbids political, religious, deceptive and adult-business use                        |
| 冥鳴ひまり                                   | VOICEVOX:冥鳴ひまり                                                              | [冥鳴ひまり](https://www.meimeihimari.com/terms-of-use)            | Commercial or not, by anyone, with no application, with a credit; no rule on distributing the audio                                                         |
| 玄野武宏, 白上虎太郎                         | VOICEVOX:玄野武宏, VOICEVOX:白上虎太郎                                           | [VirVox Project](https://www.virvoxproject.com/voicevoxの利用規約) | Commercial or not with the credit; audio passed on as material must carry the same terms; forbids training or fine-tuning a new acoustic model on the audio |
| 剣崎雌雄                                     | VOICEVOX:剣崎雌雄                                                                | [銃口會](https://frontier.creatia.cc/fanclubs/413/posts/4507)      | Commercial or not with the credit; its bans on redistribution are of the official illustrations                                                             |

Voices left out on reading their terms: 春日部つむぎ, whose terms forbid 「二次配布」, which committing the voice's audio may be; and 青山龍星, もち子さん, No.7, 後鬼, Voidoll, ぞん子 and ユーレイちゃん, whose terms ask for a check before some uses.

So, for this folder:

- the audio may be committed and used for testing, with the credits above;
- whoever passes it on must pass on these terms with it;
- never train or fine-tune a model on it, which VirVox forbids.

Credits: VOICEVOX:四国めたん, VOICEVOX:ずんだもん, VOICEVOX:九州そら, VOICEVOX:冥鳴ひまり, VOICEVOX:中国うさぎ, VOICEVOX:玄野武宏, VOICEVOX:剣崎雌雄, VOICEVOX:白上虎太郎.

### LibriVox

`real/` holds three stretches of LibriVox recordings on the Internet Archive, each dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), all read by ekzemplaro:

| Clip          | Recording                                                                                                                         | Stretch                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `romandourou` | [ろまん燈籠](https://archive.org/details/romandourou_1212_librivox), 太宰治, part 1 (the reading T226's transcription spike used) | 30.28 s to 89.80 s, 59.5 s |
| `gongitsune`  | [ごん狐](https://archive.org/details/gongitsune_um_librivox), 新美南吉, part 1                                                    | 29.75 s to 58.98 s, 29.2 s |
| `good-bye`    | [グッド・バイ](https://archive.org/details/good-bye_um_librivox), 太宰治, part 1                                                  | 28.55 s to 57.35 s, 28.8 s |

Each is the 64 kbps MP3 as the Internet Archive serves it, at its own 22.05 kHz, cut between pauses; its labels name the file, its SHA-1, the item, the licence and the ffmpeg that decoded it.
Every CC0 Japanese recording on LibriVox found on 2026-11-09 has the same reader, so these are one voice reading literary prose aloud.

Beside each, `<clip>.txt` is what the stretch reads, from the work's public-domain text on [Aozora Bunko](https://www.aozora.gr.jp/) (ろまん燈籠 `cards/000035/files/315_20041.html`, ごん狐 `cards/000121/files/628_14895.html`, グッド・バイ `cards/000035/files/258_20179.html`, all three authors dead over seventy years), with its ruby readings and line breaks taken out: the reference `npm run text:study` counts character error against (`docs/transcription.md`).
Its first and last words were found by lining whisper-small's transcript up with the whole text; it is the book's text, so a word the reader said otherwise than the book counts as an error too.

### Room noise

`noise/classroom.wav` is cut from ["Geräusche aus einem Chemie-Lehrsaal 20240827 C1003.wav"](https://commons.wikimedia.org/wiki/File:Ger%C3%A4usche_aus_einem_Chemie-Lehrsaal_20240827_C1003.wav) by PantheraLeo1359531, on Wikimedia Commons, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): a chemistry classroom's ceiling light and, probably, its ventilation.
It was mixed from stereo to mono and resampled from 48 kHz to 24 kHz, and the `.room` fixtures have it mixed under their speech; they are under the same licence and credit.

### The example local pack

`local-pack/` is never Daniel's `local/`: it is made by `npm run fixtures:local-pack` (`scripts/local-pack-fixture.ts`) from the fixtures above, the same bytes every run, and `tests/scripts/local-pack-fixture.test.ts` remakes it.
`audio/hashi.wav` and `audio/kyou.wav` are `voices/hashi-o-watarimasu/meimei-himari/right.wav` and `voices/kyou-wa-eki-de/meimei-himari/right.wav`, under their terms and credit, VOICEVOX:冥鳴ひまり; `audio/gongitsune.wav` is the first 8 s of `real/gongitsune.wav`, under CC0 1.0.
Its `pack.json` gives the phrases their text, one its kana and a planted YouTube link the tests watch is never fetched, and gives the reading two lines with no text, one linking its source on the Internet Archive.

## How synthetic speech differs from a learner's

Read every result on these fixtures as a check that the code behaves as designed, never as accuracy on real takes.

- **The accent is perfect or wrong by construction.** Every fixture's pitch follows one pattern of high and low morae, the same shape in every voice, scaled to the voice; a learner is partly right, late, early, or right with a weak fall, and a native speaker's own takes vary in shape as well as level.
- **The wrong takes are a few kinds.** A moved or lost fall in one accent phrase, or one changed mora; a learner's errors mix, and include a rise in the wrong place, a fall too small, flat whole phrases, and English-like stress.
- **The pitch is clean.** VOICEVOX's F0 glides between its step targets with no jitter, creak, octave slips or reset from a real breath; a tracker that works here may still stumble on a real voice, and a sentence-final mora VOICEVOX makes breathy may track as unvoiced.
- **The voices are characters.** Several are cartoon voices, high and bright; none is a learner, and none has a learner's accent from another language.
- **The timing is the model's.** Slower, faster and uneven are scalings of VOICEVOX's own lengths; a learner's rhythm wanders in other ways, pauses mid-word, and restarts.
- **The room and the phone are imitations.** One stationary noise at one level, and an ideal band filter; real rooms reverberate and change, and real phones compress, gate and drop audio.
- **The real clips are one reader.** The LibriVox stretches are one reader reading prose, in one recording chain, compressed as MP3.
