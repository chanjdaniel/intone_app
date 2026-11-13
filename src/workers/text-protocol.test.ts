import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { FromText, ToText, transferables } from './text-protocol'

const model = {
  name: 'whisper-base/0123456789abcdef',
  files: [{ path: 'config.json', bytes: 2243 }],
}

describe('the text protocol', () => {
  test("transfers the clip's audio, and nothing else", () => {
    const transcribe: ToText = {
      _tag: 'Transcribe',
      model,
      samples: new Float32Array(16),
      windows: [{ from: 0, to: 1 }],
    }

    expect(transferables(transcribe)).toStrictEqual([transcribe.samples.buffer])
    expect(transferables({ _tag: 'Download', model })).toStrictEqual([])
    expect(
      transferables({
        _tag: 'Transcribed',
        device: 'Wasm',
        pieces: [{ text: '雨', from: 0, to: 0.2 }],
      }),
    ).toStrictEqual([])
  })

  test('refuses what neither side says', () => {
    expect(() =>
      Schema.decodeUnknownSync(ToText)({ _tag: 'Transcribe', model }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(FromText)({
        _tag: 'Transcribed',
        device: 'Gpu',
        pieces: [],
      }),
    ).toThrow()
    expect(
      Schema.decodeSync(FromText)({
        _tag: 'Progress',
        step: 'Downloading',
        done: 10,
        total: 75,
      }),
    ).toStrictEqual({
      _tag: 'Progress',
      step: 'Downloading',
      done: 10,
      total: 75,
    })
  })
})
