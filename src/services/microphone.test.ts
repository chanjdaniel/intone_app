import { describe, expect, it } from 'vitest'

import { audioConstraints, microphoneErrorOf } from './microphone'

describe('microphoneErrorOf', () => {
  it.each([
    ['NotAllowedError', 'Denied'],
    ['SecurityError', 'Denied'],
    ['NotFoundError', 'NoDevice'],
    ['OverconstrainedError', 'NoDevice'],
    ['NotReadableError', 'Failed'],
    ['AbortError', 'Failed'],
  ])('tells the learner %s as %s', (name, failure) => {
    const error = microphoneErrorOf(new DOMException('it said no', name))
    expect(error.failure).toBe(failure)
    expect(error.message).toBe('it said no')
  })

  it('counts anything else as a failure, with its message', () => {
    expect(microphoneErrorOf(new TypeError('no audio')).failure).toBe('Failed')
    expect(microphoneErrorOf('odd').message).toBe('odd')
  })
})

describe('audioConstraints', () => {
  it('asks for the browser speech processing off', () => {
    expect(audioConstraints).toStrictEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    })
  })
})
