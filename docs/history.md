# History on the device

Every scored take is kept on the learner's device, and nowhere else.
This page says what is kept, in what format, how it changes format, what the backup holds, and how the history screens hold up at 5,000 takes.

## What a take keeps

A take that was tracked is kept when `AnalyseTake` has scored it, whether the score compared it or not; a take too quiet or too noisy to track has no curve, and is not kept.

| Store (IndexedDB `intone`) | One record per               | Holds                                                                                                                                                       |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `takes`                    | take                         | the clip, the line and its text then, guided or blind, the time and the learner's day, the score with its version, and the kept audio's file or none        |
| `takeRecordings`           | take                         | the take's curve (pitch, confidence, level, onset) and features, as the tracker made them, and its pitch at each native frame through the score's alignment |
| `natives`                  | native recording, by content | the native's curve and features a take was scored against, kept once however many takes share it                                                            |
| `meta`                     | key                          | `format` (the history's format, 1) and `settings` (`keepTakeAudio`, off until the learner turns it on)                                                      |
| `nativeCurves`             | line                         | each line's native curve, tracked once (ticket 09); not history, but cleared with it                                                                        |

The screens read only `takes`; a take's recording and native are read to draw it on its line's page or to score it again.
A take keeps the id of the native it was scored against, so a line of the learner's clip whose start or end has changed since, and so has a new curve, keeps its earlier takes apart on its page, with a trend of their own.
The native's recording is kept with the history, not only in the native-curve cache, because a take is scored against the native it was scored against, which a new tracker or a new recording of the line would change.

Every record is decoded by its Schema (`src/services/history-records.ts`) on every read.
A record that does not decode, damaged or written by something else, is counted and left out, and `/history` says how many.

A take's audio is kept only once the learner turns that on in `/settings`, as a 16-bit mono WAV at the capture's rate in the origin private file system (`takes/<take id>.wav`), and is deleted with its take.

## Format and its changes

The database is at version 3.
Version 1 (ticket 09) held `nativeCurves` alone; opening it adds the history's stores and `meta`'s format, and keeps the native curves, which `src/services/history-store.test.ts` and `tests/e2e/history.spec.ts` prove on a planted version 1 database.
Version 3 (ticket 13) adds `clips`, the learner's own clips and their lines (`docs/uploads.md`); the records of version 2 are unchanged, so the history's format stays 1.
Ticket 14 adds three keys a clip record may lack, so a record written before them still decodes and the format stays 1: each tracked line's `quality`, the clip's `nextLineId` and its `undo` (the lines before the last change).
A change to a clip's lines keeps the curves its undo names, and deletes each curve the clip stops naming that no other clip, undo or take names.
A later format bumps the version, converts the records it changes in `upgrade` (`src/services/indexed-db.ts`), and writes its number to `meta`; a copy of the app older than the database refuses to open it, and says to reload.

## Scoring again

Each score keeps the `SCORE_VERSION` that made it, and a line's page says which.
When `SCORE_VERSION` moves, `/history` offers to score the older takes again from their kept curves and features, 20 at a time so the screen stays responsive, and replaces their scores.

## The backup

One zip file, `intone-history-<day>.zip`, saved by the browser where the learner chooses:

- `history.json`: `{ app: "intone", kind: "history backup", format, exportedAt, settings, natives, takes, clips }`, the same records as the stores, each frame array as base64 of its little-endian Float32 bytes, so every value comes back exactly; a backup made before clips has no `clips`, and reads as having none.
- `audio/<take id>.wav`: the kept audio, and `clips/<clip id>.<extension>`: each clip's own file, only when the learner asks for the recordings; a take or clip whose audio is left out keeps no reference to it, and a clip restored without it keeps the file the device already has, or says its audio is not on the device.

Every entry is dated by the backup, so the same history saved at the same moment is the same file, byte for byte.
Restoring reads the file whole first, by the same Schemas, and refuses it, restoring nothing, when it is not a zip, has no `history.json`, holds anything that does not decode, names a native it does not hold, or misses or damages an audio file or clip file it names.
A take already on the device (the same id) is replaced, so restoring the same backup twice adds nothing.

## At scale

`tests/e2e/history.spec.ts` restores a seeded history of 5,000 takes of 160 lines over 242 days, one line holding 1,250 of them (`tests/support/history-fixture.ts`, pinned by `tests/scripts/history-fixture.test.ts`), through the settings screen, then times each screen from its address to its content drawn.
Measured on the development machine (headless Chromium, load average about 1.3):

| Step                                         | Time   |
| -------------------------------------------- | ------ |
| Restore the 41 MB backup                     | 1.3 s  |
| `/history`: the calendar and 50 of 160 lines | 0.29 s |
| The 1,250-take line's page, its curves drawn | 0.23 s |

The test fails above 3 s for either screen, ten times the measured time, for CI's slower machines.
The 5,000 takes used 53 MB of storage (`navigator.storage.estimate()`), about 11 kB a take, most of it the take's features (24 values a frame).
