# The sounds part on the fixtures

Written by `npm run sounds:study` (scripts/sounds-study.ts) from the frames `npm run sounds:features` keeps in `.cache/sounds/features/` and from fixtures/tracked/.
docs/sounds.md states the bar these numbers are read against, and what was done with them.

A model's sounds part is its cosine DTW distance over the speech, on a scale where the clean right takes' median scores 1 and a take of other words' median scores 0.
"Spread" is the widest gap between the seven other voices' right takes of one native, phrase and condition; "same voice" is the share of right takes above the mora-changed take of the same native, take voice and condition; "across voices" is the chance a right take in any voice is above a mora-changed take in any voice, for the same native and condition.

## Whisper-base's encoder (q4)

Scale: a distance of 0.102 scores 1 (the clean right takes' median) and 0.553 scores 0 (other words' median); a right take's distance runs 0.076 to 0.152 from its 10th to 90th percentile, other words' 0.486 to 0.617.

| Phrase | Condition | Spread, median | Spread, worst | Same voice | Across voices | Same voice, raw | Across voices, raw | Right, median part | Mora changed, median part |
| - | - | - | - | - | - | - | - | - | - |
| ame-ga-suki (5) | clean | 0.10 | 0.11 | 0.982 | 0.895 | 0.982 | 0.895 | 0.97 | 0.89 |
| ame-ga-suki (5) | room | 0.11 | 0.14 | 0.982 | 0.893 | 0.982 | 0.893 | 0.96 | 0.88 |
| ame-ga-suki (5) | phone | 0.10 | 0.10 | 1.000 | 0.923 | 1.000 | 0.923 | 0.96 | 0.88 |
| hashi-o-watarimasu (8) | clean | 0.07 | 0.09 | 0.973 | 0.903 | 1.000 | 0.923 | 1.00 | 0.95 |
| hashi-o-watarimasu (8) | room | 0.10 | 0.12 | 1.000 | 0.967 | 1.000 | 0.967 | 0.99 | 0.88 |
| hashi-o-watarimasu (8) | phone | 0.03 | 0.06 | 0.991 | 0.982 | 1.000 | 0.990 | 1.00 | 0.92 |
| kyou-wa-eki-de (19) | clean | 0.15 | 0.21 | 0.813 | 0.619 | 0.946 | 0.658 | 1.00 | 0.98 |
| kyou-wa-eki-de (19) | room | 0.18 | 0.23 | 0.902 | 0.693 | 0.982 | 0.696 | 1.00 | 0.96 |
| kyou-wa-eki-de (19) | phone | 0.17 | 0.20 | 0.839 | 0.633 | 1.000 | 0.679 | 1.00 | 0.98 |

Level across voices passes; a changed mora in the same voice fails; across voices fails.

## WavLM-Base+ (int8)

Scale: a distance of 0.279 scores 1 (the clean right takes' median) and 0.752 scores 0 (other words' median); a right take's distance runs 0.213 to 0.667 from its 10th to 90th percentile, other words' 0.674 to 0.818.

| Phrase | Condition | Spread, median | Spread, worst | Same voice | Across voices | Same voice, raw | Across voices, raw | Right, median part | Mora changed, median part |
| - | - | - | - | - | - | - | - | - | - |
| ame-ga-suki (5) | clean | 0.32 | 0.47 | 0.643 | 0.636 | 0.696 | 0.653 | 0.95 | 0.85 |
| ame-ga-suki (5) | room | 0.24 | 0.30 | 0.571 | 0.564 | 0.589 | 0.584 | 0.92 | 0.90 |
| ame-ga-suki (5) | phone | 0.35 | 0.45 | 0.705 | 0.610 | 0.786 | 0.635 | 0.89 | 0.84 |
| hashi-o-watarimasu (8) | clean | 0.82 | 0.86 | 0.732 | 0.661 | 0.804 | 0.676 | 1.00 | 0.87 |
| hashi-o-watarimasu (8) | room | 0.19 | 0.28 | 0.848 | 0.742 | 0.875 | 0.753 | 0.90 | 0.78 |
| hashi-o-watarimasu (8) | phone | 0.16 | 0.18 | 0.795 | 0.721 | 0.875 | 0.750 | 0.98 | 0.88 |
| kyou-wa-eki-de (19) | clean | 1.00 | 1.00 | 0.536 | 0.467 | 0.696 | 0.495 | 1.00 | 1.00 |
| kyou-wa-eki-de (19) | room | 0.08 | 0.20 | 0.696 | 0.615 | 0.821 | 0.656 | 0.92 | 0.91 |
| kyou-wa-eki-de (19) | phone | 0.13 | 0.22 | 0.625 | 0.561 | 0.679 | 0.571 | 0.99 | 0.98 |

Level across voices fails; a changed mora in the same voice fails; across voices fails.

## WavLM-Base+ (fp32)

Scale: a distance of 0.224 scores 1 (the clean right takes' median) and 0.748 scores 0 (other words' median); a right take's distance runs 0.169 to 0.336 from its 10th to 90th percentile, other words' 0.704 to 0.809.

| Phrase | Condition | Spread, median | Spread, worst | Same voice | Across voices | Same voice, raw | Across voices, raw | Right, median part | Mora changed, median part |
| - | - | - | - | - | - | - | - | - | - |
| ame-ga-suki (5) | clean | 0.22 | 0.28 | 0.848 | 0.666 | 0.911 | 0.673 | 0.93 | 0.86 |
| ame-ga-suki (5) | room | 0.23 | 0.35 | 0.571 | 0.587 | 0.607 | 0.594 | 0.91 | 0.90 |
| ame-ga-suki (5) | phone | 0.25 | 0.30 | 0.688 | 0.611 | 0.750 | 0.615 | 0.92 | 0.88 |
| hashi-o-watarimasu (8) | clean | 0.09 | 0.13 | 0.884 | 0.777 | 0.946 | 0.788 | 1.00 | 0.93 |
| hashi-o-watarimasu (8) | room | 0.24 | 0.31 | 0.964 | 0.809 | 0.964 | 0.809 | 0.86 | 0.76 |
| hashi-o-watarimasu (8) | phone | 0.18 | 0.23 | 0.911 | 0.751 | 0.946 | 0.760 | 0.95 | 0.88 |
| kyou-wa-eki-de (19) | clean | 0.04 | 0.07 | 0.688 | 0.588 | 0.982 | 0.635 | 1.00 | 1.00 |
| kyou-wa-eki-de (19) | room | 0.07 | 0.13 | 0.732 | 0.601 | 0.911 | 0.666 | 1.00 | 0.99 |
| kyou-wa-eki-de (19) | phone | 0.07 | 0.11 | 0.750 | 0.578 | 0.982 | 0.638 | 1.00 | 1.00 |

Level across voices passes; a changed mora in the same voice fails; across voices fails.

## WavLM-Large (q4)

Scale: a distance of 0.269 scores 1 (the clean right takes' median) and 0.802 scores 0 (other words' median); a right take's distance runs 0.206 to 0.385 from its 10th to 90th percentile, other words' 0.755 to 0.860.

| Phrase | Condition | Spread, median | Spread, worst | Same voice | Across voices | Same voice, raw | Across voices, raw | Right, median part | Mora changed, median part |
| - | - | - | - | - | - | - | - | - | - |
| ame-ga-suki (5) | clean | 0.22 | 0.36 | 0.804 | 0.661 | 0.911 | 0.686 | 0.90 | 0.81 |
| ame-ga-suki (5) | room | 0.34 | 0.43 | 0.688 | 0.519 | 0.732 | 0.528 | 0.83 | 0.85 |
| ame-ga-suki (5) | phone | 0.26 | 0.38 | 0.786 | 0.620 | 0.893 | 0.638 | 0.90 | 0.86 |
| hashi-o-watarimasu (8) | clean | 0.07 | 0.17 | 0.929 | 0.793 | 1.000 | 0.827 | 1.00 | 0.92 |
| hashi-o-watarimasu (8) | room | 0.22 | 0.26 | 0.982 | 0.855 | 0.982 | 0.855 | 0.87 | 0.75 |
| hashi-o-watarimasu (8) | phone | 0.18 | 0.23 | 0.982 | 0.844 | 0.982 | 0.844 | 0.98 | 0.86 |
| kyou-wa-eki-de (19) | clean | 0.05 | 0.05 | 0.696 | 0.578 | 1.000 | 0.625 | 1.00 | 1.00 |
| kyou-wa-eki-de (19) | room | 0.09 | 0.15 | 0.723 | 0.598 | 0.893 | 0.643 | 1.00 | 0.99 |
| kyou-wa-eki-de (19) | phone | 0.06 | 0.10 | 0.714 | 0.580 | 0.929 | 0.622 | 1.00 | 1.00 |

Level across voices fails; a changed mora in the same voice fails; across voices fails.

## The aligners

Each model's last layer on the curve's frames, normalised per take over its speech and lined up by the score's DTW, beside ticket 10's chosen log mel bands and the labelled mora boundaries: the raw pitch skill on each path, and how far the path puts the native's labelled mora starts from the take's.

| Aligner | Mora start error, median ms | p90 ms | Chance right beats wrong, 5 morae | Chance right beats wrong, 8 morae | Chance right beats wrong, 19 morae | Right, median skill | Wrong, median skill |
| - | - | - | - | - | - | - | - |
| DTW on 24 log mel bands, 100-7600 Hz (chosen) | 11 | 32 | 0.993 | 1.000 | 0.968 | 0.65 | 0.07 |
| Labelled mora boundaries (ceiling) | 5 | 11 | 1.000 | 1.000 | 0.983 | 0.64 | 0.04 |
| DTW on Whisper-base's encoder (q4)'s last layer | 11 | 27 | 1.000 | 1.000 | 0.980 | 0.65 | 0.05 |
| DTW on WavLM-Base+ (int8)'s last layer | 11 | 48 | 0.991 | 0.977 | 0.920 | 0.63 | 0.04 |
| DTW on WavLM-Base+ (fp32)'s last layer | 11 | 27 | 0.997 | 1.000 | 0.980 | 0.65 | 0.05 |
| DTW on WavLM-Large (q4)'s last layer | 11 | 27 | 0.998 | 1.000 | 0.980 | 0.65 | 0.05 |
