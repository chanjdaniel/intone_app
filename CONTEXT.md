# Intone's words

Every screen, test, doc and name in the code uses these words with these meanings.

- **Clip:** one recording: a bundled starter recording, an upload, or a local-pack file.
- **Line:** a stretch of a clip, with a start and end, to copy; optionally with text and kana.
- **Level:** a clip's lines in order, with their stars; the starter set is several levels by accent pattern.
- **Take:** one recording of the learner copying a line.
  A **guided** take shows the native curve and the live curve; a **blind** take hides both until it ends.
- **Curve:** the tracker's output for a recording: pitch, confidence and level per 16 ms frame, and the onset.
- **Native curve, learner curve:** the curve of the line and the curve of the take.
- **Match:** the headline, "N% match to this clip".
  Its **parts** are pitch accent, timing and sounds.
- **Worst stretch:** the 400 ms of the line where the take's pitch part is lowest.
- **Couldn't compare:** the score's answer when a take cannot be scored fairly.
- **Stars:** per line, 0 to 3: one for reaching the clip's threshold on a guided take, two for beating it, three for reaching it blind.
- **Starter set:** the bundled, openly licensed lines.
- **Local pack:** Daniel's untracked `local/` folder and its manifest.
- **Fixture:** generated, labelled test audio with its known curve, accent and mora boundaries.

The app says "match", never "accuracy", and never that a take is correct: it claims only what it measured.
