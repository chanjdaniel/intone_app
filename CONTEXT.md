# Intone's words

Every screen, test, doc and name in the code uses these words with these meanings.

- **Clip:** one recording: a bundled starter recording, an upload, or a local-pack file.
- **Line:** a stretch of a clip, with a start and end, to copy; optionally with text and kana.
- **Level:** a clip's lines in order, with their stars; the starter set is several levels by accent pattern.
- **Take:** one recording of the learner copying a line.
  A **guided** take shows the native curve and the live curve; a **blind** take hides both until it ends.
- **Curve:** the tracker's output for a recording: pitch, confidence and level per 16 ms frame, and the onset.
- **Native curve, learner curve:** the curve of the line and the curve of the take.
- **Live curve:** the learner curve drawn during the take, frame by frame as the tracker finds them, about a quarter second behind the voice, over the native curve; when the take ends it takes the finished curve's shape.
- **Closeness:** how near each moment of the learner curve is to the native curve within about 150 ms either way, each around its own speaker's median, shown only as the line's colour, from blue for close to orange for far, never as a number.
  During a take it compares the same time since each onset; after a scored take, the learner curve is drawn along the alignment, so it compares the moments the score paired.
- **Practice screen:** a line's own screen, `/line/:clipId/:lineId`: the line, both curves, listening again, and the take.
- **Features:** what a recording sounds like frame by frame, never its pitch: the bands of its spectrum, which the score lines a take up with the line by.
- **Alignment:** the pairs of line and take frames that say the same sound, found from their features; the pitch accent part compares along it and the timing part reads its pace.
- **Match:** the headline, "N% match to this clip".
  Its **parts** are pitch accent, timing and sounds.
- **Worst stretch:** the 400 ms of the line where the take's pitch part is lowest.
- **Couldn't compare:** the score's answer when a take cannot be scored fairly.
- **Score card:** what the practice screen shows after a take: the match and its parts by name, and the worst stretch, shaded on both curves and playable from both voices; or, when it couldn't compare, what to try and no number.
- **History:** every take kept on the device, with both curves and features, its score and the score's version; `/history` shows the days practised (the **practice calendar**, which counts only what was done) and the lines practised, and a line's history its first, best and latest takes over the native curve and its **trend**, the match take by take.
- **Kept audio:** a take's own recording, kept with it only once the learner turns that on, and deleted with it.
- **Backup:** one zip file the learner saves on their own device, holding the history and, only when asked, the kept audio; restoring it adds its takes to the history there.
- **Stars:** per line, 0 to 3: one for reaching the clip's threshold on a guided take, two for beating it, three for reaching it blind.
- **Starter set:** the bundled, openly licensed lines.
- **Local pack:** Daniel's untracked `local/` folder and its manifest.
- **Fixture:** generated, labelled test audio with its known curve, accent and mora boundaries.

The app says "match", never "accuracy", and never that a take is correct: it claims only what it measured.
