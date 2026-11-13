# Intone's words

Every screen, test, doc and name in the code uses these words with these meanings.

- **Clip:** one recording: a bundled starter recording, an upload, or a local-pack file.
- **Line:** a stretch of a clip, with a start and end, to copy; optionally with text and kana.
- **Level:** a clip's lines in order, with their stars, at `/level/:clipId`: a bundled clip's, an upload's or the local pack's; the starter set is six levels, one per accent pattern, then pairs and phrases.
- **Take:** one recording of the learner copying a line.
  A **guided** take shows the native curve and the live curve; a **blind** take hides both until it ends.
- **Curve:** the tracker's output for a recording: pitch, confidence and level per 16 ms frame, and the onset.
- **Native curve, learner curve:** the curve of the line and the curve of the take.
- **Live curve:** the learner curve drawn during the take, frame by frame as the tracker finds them, about a quarter second behind the voice, over the native curve; when the take ends it takes the finished curve's shape.
- **Closeness:** how near each moment of the learner curve is to the native curve within about 150 ms either way, each around its own speaker's median, shown only as the line's colour, from blue for close to orange for far, never as a number.
  During a take it compares the same time since each onset; after a scored take, the learner curve is drawn along the alignment, so it compares the moments the score paired.
- **Practice screen:** a line's own screen, `/line/:clipId/:lineId`: the line and its stars, both curves, listening again, the take, and the next line.
- **Features:** what a recording sounds like frame by frame, never its pitch: the bands of its spectrum, which the score lines a take up with the line by.
- **Alignment:** the pairs of line and take frames that say the same sound, found from their features; the pitch accent part compares along it and the timing part reads its pace.
- **Match:** the headline, "N% match to this clip".
  Its **parts** are pitch accent and timing; a **sounds** part (the vowels and consonants) joins them only once a speech model passes the bar in `docs/sounds.md`, which none has.
- **Worst stretch:** the 400 ms of the line where the take's pitch part is lowest.
- **Couldn't compare:** the score's answer when a take cannot be scored fairly.
- **Score card:** what the practice screen shows after a take: the match and its parts by name, and the worst stretch, shaded on both curves and playable from both voices; or, when it couldn't compare, what to try and no number.
- **History:** every take kept on the device, with both curves and features, its score and the score's version; `/history` shows the days practised (the **practice calendar**, which counts only what was done) and the lines practised, and a line's history its first, best and latest takes over the native curve and its **trend**, the match take by take.
- **Kept audio:** a take's own recording, kept with it only once the learner turns that on, and deleted with it.
- **Backup:** one zip file the learner saves on their own device, holding the history and the learner's clips and their lines and, only when asked, the kept audio and the clips' own audio; restoring it adds them to the device there.
- **Upload:** a clip the learner brings from a file, chosen or dropped on `/upload`; it stays on the device.
- **Line editor:** an upload's level's tools for fixing its cut: a line's start and end dragged or stepped, a line split at the playhead, merged with a neighbour or deleted, and the last change undone once; the lines a change moves are tracked again.
- **Marks:** a line's warning that its native curve is weak: low pitch confidence (little of its speech pitched) or likely music (a pitch through most of its pauses).
- **Cut:** making an upload's lines: its speech found by Silero VAD, cut at pauses of about 300 ms into lines of about 1 to 4 s, and each line's native curve tracked, all in the clip Worker, with its progress shown and a way to stop it.
- **Text model:** Whisper base (whisper-small as the larger option), which writes out an upload's text on the device, downloaded only once the learner agrees in the **consent dialog**, which names its size; "Not now" is kept, and `/settings` offers it again.
- **Transcript:** an upload's text as the text model wrote it, in small pieces each with its time, matched to the lines by time each time they are shown; a line's **own text**, typed or pasted by the learner, stands over it. Text is for reading only: no score reads it.
- **Readings:** the kana shown over a line's kanji, from a dictionary run on the device once the learner shows them, which the learner can edit word by word; like the text, for reading only.
- **Stars:** per line, 0 to 3: one for reaching the clip's threshold on a guided take, two for beating it, three for reaching it blind; worked out from the line's kept takes, so a take that couldn't compare never costs one.
- **Return:** a line coming back for a blind take on a later day, spaced out 1, 3, 7, 14 and 30 days after each blind take made when it was due that reaches its threshold, and the next day after one that does not; a line is **due back** from that day on, listed on the home screen with no penalty however long it waits, and only a blind take counts as its return.
- **Blind-take chart:** a line's blind takes over time on its history page, the threshold drawn across: whether practice held.
- **Personal best:** a line's best match; a take that beats it, as the screen shows them in whole percent, is marked as a new one.
- **Practice loop:** what a line's practice screen runs: hear the line, a guided take, the curves and the match, again as often as wanted, a blind take, and on to the next line of its level.
- **Starter set:** the bundled, openly licensed lines, about fifty, each credited and marked unreviewed until a native speaker has heard it (`docs/starter-set.md`).
- **Starter review:** the native speaker's verdict on each starter line, given at `/review`, a page reached only by its address, and applied to the list by `npm run starter:pack -- --apply`.
- **Local pack:** Daniel's untracked `local/` folder and its manifest, `pack.json`, imported from the files chosen as one level kept on the device; its lines may carry text, kana and a **source** link, shown and never fetched.
- **Fixture:** generated, labelled test audio with its known curve, accent and mora boundaries.
- **Local production build:** the app built by `vite build` and served by `vite preview` on the machine itself; where Daniel practises (`npm start`, `http://localhost:4300`) and where the end-to-end tests run, until there is a deploy.
- **Model directory:** the versioned folder `/models/<id>/<version>/` that holds every file of one model, whose version changes when any of its files does.

The app says "match", never "accuracy", and never that a take is correct: it claims only what it measured.
