// Every constant the score and the curve rest on, in one place, each with
// the data it came from (spec, "The score's interface"). Ticket 10 measures
// these on fixtures and ticket 22 tunes them with a native speaker.

// A frame counts as voiced from this confidence up. SwiftF0 calibrates its
// confidence so that 0.5 is its own voicing threshold (SwiftF0 0.3.0,
// `swift_f0/core.py`, `PitchResult.confidence`).
export const confidenceGate = 0.5
