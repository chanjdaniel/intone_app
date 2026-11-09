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
