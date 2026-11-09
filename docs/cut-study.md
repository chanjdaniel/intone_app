# Cutting a clip into lines: the study

Written by `npm run cut:study` from the LibriVox CC0 clips in `fixtures/real/` (one reader, a quiet room), through the clip Worker's own code (`src/engine/cut/clip.ts`) on the real Silero VAD and SwiftF0 models under Node.
Do not edit it by hand: `tests/scripts/cut-study.test.ts` remakes it and fails on any difference.
How long a cut takes is not here, since it changes from run to run; `docs/uploads.md` gives it.

The rules (`cutRules` in `src/engine/cut/lines.ts`): speech from a probability of 0.5, held until under 0.35 for 300 ms; speech under 250 ms left out; a line over 4 s cut at its longest inner silence; a line under 1 s joined to its nearer neighbour across a pause under 800 ms; 150 ms kept before each line and 200 ms after, or half the pause to its neighbour.
A line's length below includes that lead and tail, so "1 to 4.5 s" counts the lines of about 1 to 4 s of speech.

| Clip | Seconds | Lines | Shortest, s | Median, s | Longest, s | 1 to 4.5 s | With a native curve |
| - | - | - | - | - | - | - | - |
| romandourou | 59.5 | 21 | 1.12 | 2.53 | 3.93 | 21 | 21 |
| gongitsune | 29.2 | 10 | 1.73 | 2.49 | 3.23 | 10 | 10 |
| good-bye | 28.8 | 9 | 1.63 | 3.07 | 3.87 | 9 | 9 |

## The quality marks

Each tracked line's quality (`lineQuality` in `src/engine/cut/quality.ts`) pairs its curve with Silero's windows over it: the share of its speech (a window at 0.5 or over) with a confident pitch, and the share of its pauses (under 0.35, 64 ms or more from speech) that still have one.
A line is marked for low pitch confidence under 0.4 confident speech, with 16 speech frames or more, and as likely music over 0.5 pitched pauses, with 8 pause frames or more.
Below, each clip clean, under the classroom noise (`fixtures/noise/`) 8 dB below its speech, and over the synthetic music bed (`tests/support/music-bed.ts`, held chords and a melody, not real music) 15, 20, 25 dB below it; a line with no curve (too noisy, mostly) has no quality.

| Clip | Heard | Lines | With a curve | Confident speech | Pitched pauses | Low confidence | Likely music |
| - | - | - | - | - | - | - | - |
| romandourou | Clean | 21 | 21 | 0.50 to 0.77 | 0.00 to 0.00 | 0 | 0 |
| romandourou | Classroom noise, 8 dB under | 20 | 14 | 0.50 to 0.72 | 0.00 to 0.04 | 0 | 0 |
| romandourou | Music bed, 15 dB under | 20 | 18 | 0.62 to 0.81 | 0.31 to 0.94 | 0 | 14 |
| romandourou | Music bed, 20 dB under | 20 | 20 | 0.60 to 0.83 | 0.15 to 0.88 | 0 | 10 |
| romandourou | Music bed, 25 dB under | 20 | 20 | 0.58 to 0.83 | 0.00 to 0.80 | 0 | 2 |
| gongitsune | Clean | 10 | 10 | 0.57 to 0.78 | 0.00 to 0.00 | 0 | 0 |
| gongitsune | Classroom noise, 8 dB under | 10 | 10 | 0.48 to 0.67 | 0.00 to 0.10 | 0 | 0 |
| gongitsune | Music bed, 15 dB under | 10 | 8 | 0.60 to 0.82 | 0.29 to 0.91 | 0 | 4 |
| gongitsune | Music bed, 20 dB under | 10 | 10 | 0.56 to 0.79 | 0.11 to 0.71 | 0 | 6 |
| gongitsune | Music bed, 25 dB under | 10 | 10 | 0.57 to 0.78 | 0.05 to 0.62 | 0 | 2 |
| good-bye | Clean | 9 | 9 | 0.64 to 0.78 | 0.00 to 0.00 | 0 | 0 |
| good-bye | Classroom noise, 8 dB under | 9 | 8 | 0.56 to 0.73 | 0.00 to 0.00 | 0 | 0 |
| good-bye | Music bed, 15 dB under | 9 | 9 | 0.66 to 0.85 | 0.08 to 0.82 | 0 | 6 |
| good-bye | Music bed, 20 dB under | 9 | 9 | 0.63 to 0.79 | 0.08 to 0.68 | 0 | 2 |
| good-bye | Music bed, 25 dB under | 9 | 9 | 0.65 to 0.79 | 0.00 to 0.57 | 0 | 1 |

## Each line

### romandourou

| Line | From, s | To, s | Length, s | Native curve | Voiced frames | Confident speech | Pitched pauses |
| - | - | - | - | - | - | - | - |
| 1 | 0.39 | 2.95 | 2.56 | Tracked | 75 | 0.67 | 0.00 of 31 |
| 2 | 3.21 | 6.31 | 3.10 | Tracked | 126 | 0.73 | 0.00 of 13 |
| 3 | 6.67 | 9.90 | 3.23 | Tracked | 109 | 0.65 | 0.00 of 19 |
| 4 | 9.96 | 12.26 | 2.30 | Tracked | 86 | 0.70 | 0.00 of 13 |
| 5 | 12.59 | 15.05 | 2.46 | Tracked | 78 | 0.70 | 0.00 of 25 |
| 6 | 15.18 | 17.96 | 2.78 | Tracked | 98 | 0.64 | 0.00 of 13 |
| 7 | 18.54 | 21.06 | 2.53 | Tracked | 90 | 0.66 | 0.00 of 13 |
| 8 | 21.29 | 23.47 | 2.18 | Tracked | 83 | 0.68 | 0.00 of 6 |
| 9 | 23.47 | 25.70 | 2.23 | Tracked | 63 | 0.50 | 0.00 of 10 |
| 10 | 26.31 | 28.94 | 2.62 | Tracked | 81 | 0.66 | 0.00 of 25 |
| 11 | 29.13 | 30.57 | 1.44 | Tracked | 34 | 0.52 | 0.00 of 15 |
| 12 | 30.67 | 33.13 | 2.46 | Tracked | 96 | 0.73 | 0.00 of 13 |
| 13 | 33.39 | 35.91 | 2.53 | Tracked | 97 | 0.73 | 0.00 of 13 |
| 14 | 35.98 | 39.91 | 3.93 | Tracked | 141 | 0.63 | 0.00 of 13 |
| 15 | 40.62 | 41.74 | 1.12 | Tracked | 37 | 0.77 | 0.00 of 13 |
| 16 | 41.80 | 45.61 | 3.81 | Tracked | 131 | 0.68 | 0.00 of 19 |
| 17 | 45.71 | 49.32 | 3.61 | Tracked | 115 | 0.64 | 0.00 of 23 |
| 18 | 49.58 | 51.14 | 1.57 | Tracked | 46 | 0.61 | 0.00 of 13 |
| 19 | 51.27 | 53.13 | 1.85 | Tracked | 60 | 0.64 | 0.00 of 13 |
| 20 | 53.32 | 56.58 | 3.26 | Tracked | 102 | 0.60 | 0.00 of 15 |
| 21 | 57.23 | 59.50 | 2.27 | Tracked | 76 | 0.63 | 0.00 of 13 |

### gongitsune

| Line | From, s | To, s | Length, s | Native curve | Voiced frames | Confident speech | Pitched pauses |
| - | - | - | - | - | - | - | - |
| 1 | 0.68 | 3.69 | 3.01 | Tracked | 82 | 0.62 | 0.00 of 41 |
| 2 | 3.79 | 6.70 | 2.91 | Tracked | 91 | 0.63 | 0.00 of 19 |
| 3 | 7.11 | 10.34 | 3.23 | Tracked | 116 | 0.70 | 0.00 of 19 |
| 4 | 11.43 | 13.19 | 1.76 | Tracked | 62 | 0.78 | 0.00 of 13 |
| 5 | 13.26 | 15.11 | 1.85 | Tracked | 63 | 0.67 | 0.00 of 13 |
| 6 | 15.34 | 17.83 | 2.49 | Tracked | 80 | 0.68 | 0.00 of 21 |
| 7 | 18.63 | 21.06 | 2.43 | Tracked | 77 | 0.71 | 0.00 of 27 |
| 8 | 21.39 | 23.88 | 2.49 | Tracked | 84 | 0.65 | 0.00 of 13 |
| 9 | 24.01 | 25.74 | 1.73 | Tracked | 49 | 0.57 | 0.00 of 13 |
| 10 | 26.54 | 29.22 | 2.69 | Tracked | 71 | 0.62 | 0.00 of 37 |

### good-bye

| Line | From, s | To, s | Length, s | Native curve | Voiced frames | Confident speech | Pitched pauses |
| - | - | - | - | - | - | - | - |
| 1 | 0.33 | 4.10 | 3.77 | Tracked | 125 | 0.72 | 0.00 of 35 |
| 2 | 4.39 | 7.78 | 3.39 | Tracked | 129 | 0.68 | 0.00 of 13 |
| 3 | 8.11 | 11.98 | 3.87 | Tracked | 125 | 0.67 | 0.00 of 31 |
| 4 | 12.71 | 15.78 | 3.07 | Tracked | 96 | 0.65 | 0.00 of 19 |
| 5 | 16.17 | 18.34 | 2.17 | Tracked | 89 | 0.78 | 0.00 of 13 |
| 6 | 18.51 | 20.84 | 2.33 | Tracked | 79 | 0.64 | 0.00 of 13 |
| 7 | 21.32 | 23.24 | 1.92 | Tracked | 64 | 0.74 | 0.00 of 17 |
| 8 | 23.53 | 25.16 | 1.63 | Tracked | 57 | 0.71 | 0.00 of 13 |
| 9 | 25.58 | 28.78 | 3.20 | Tracked | 134 | 0.76 | 0.00 of 13 |
