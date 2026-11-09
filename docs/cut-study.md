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

## Each line

### romandourou

| Line | From, s | To, s | Length, s | Native curve | Voiced frames |
| - | - | - | - | - | - |
| 1 | 0.39 | 2.95 | 2.56 | Tracked | 75 |
| 2 | 3.21 | 6.31 | 3.10 | Tracked | 126 |
| 3 | 6.67 | 9.90 | 3.23 | Tracked | 109 |
| 4 | 9.96 | 12.26 | 2.30 | Tracked | 86 |
| 5 | 12.59 | 15.05 | 2.46 | Tracked | 78 |
| 6 | 15.18 | 17.96 | 2.78 | Tracked | 98 |
| 7 | 18.54 | 21.06 | 2.53 | Tracked | 90 |
| 8 | 21.29 | 23.47 | 2.18 | Tracked | 83 |
| 9 | 23.47 | 25.70 | 2.23 | Tracked | 63 |
| 10 | 26.31 | 28.94 | 2.62 | Tracked | 81 |
| 11 | 29.13 | 30.57 | 1.44 | Tracked | 34 |
| 12 | 30.67 | 33.13 | 2.46 | Tracked | 96 |
| 13 | 33.39 | 35.91 | 2.53 | Tracked | 97 |
| 14 | 35.98 | 39.91 | 3.93 | Tracked | 141 |
| 15 | 40.62 | 41.74 | 1.12 | Tracked | 37 |
| 16 | 41.80 | 45.61 | 3.81 | Tracked | 131 |
| 17 | 45.71 | 49.32 | 3.61 | Tracked | 115 |
| 18 | 49.58 | 51.14 | 1.57 | Tracked | 46 |
| 19 | 51.27 | 53.13 | 1.85 | Tracked | 60 |
| 20 | 53.32 | 56.58 | 3.26 | Tracked | 102 |
| 21 | 57.23 | 59.50 | 2.27 | Tracked | 76 |

### gongitsune

| Line | From, s | To, s | Length, s | Native curve | Voiced frames |
| - | - | - | - | - | - |
| 1 | 0.68 | 3.69 | 3.01 | Tracked | 82 |
| 2 | 3.79 | 6.70 | 2.91 | Tracked | 91 |
| 3 | 7.11 | 10.34 | 3.23 | Tracked | 116 |
| 4 | 11.43 | 13.19 | 1.76 | Tracked | 62 |
| 5 | 13.26 | 15.11 | 1.85 | Tracked | 63 |
| 6 | 15.34 | 17.83 | 2.49 | Tracked | 80 |
| 7 | 18.63 | 21.06 | 2.43 | Tracked | 77 |
| 8 | 21.39 | 23.88 | 2.49 | Tracked | 84 |
| 9 | 24.01 | 25.74 | 1.73 | Tracked | 49 |
| 10 | 26.54 | 29.22 | 2.69 | Tracked | 71 |

### good-bye

| Line | From, s | To, s | Length, s | Native curve | Voiced frames |
| - | - | - | - | - | - |
| 1 | 0.33 | 4.10 | 3.77 | Tracked | 125 |
| 2 | 4.39 | 7.78 | 3.39 | Tracked | 129 |
| 3 | 8.11 | 11.98 | 3.87 | Tracked | 125 |
| 4 | 12.71 | 15.78 | 3.07 | Tracked | 96 |
| 5 | 16.17 | 18.34 | 2.17 | Tracked | 89 |
| 6 | 18.51 | 20.84 | 2.33 | Tracked | 79 |
| 7 | 21.32 | 23.24 | 1.92 | Tracked | 64 |
| 8 | 23.53 | 25.16 | 1.63 | Tracked | 57 |
| 9 | 25.58 | 28.78 | 3.20 | Tracked | 134 |
