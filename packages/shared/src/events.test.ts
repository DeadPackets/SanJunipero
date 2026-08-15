import { describe, it, expect } from 'vitest'
import { EventEnvelope } from './events.js'

describe('EventEnvelope', () => {
  it('accepts a valid event', () => {
    const e = EventEnvelope.parse({ seq: 0, tick: 5, type: 'agent_moved', payload: { id: 'a1' } })
    expect(e.type).toBe('agent_moved')
  })
  it('rejects negative seq and empty type', () => {
    expect(() => EventEnvelope.parse({ seq: -1, tick: 0, type: 'x', payload: null })).toThrow()
    expect(() => EventEnvelope.parse({ seq: 0, tick: 0, type: '', payload: null })).toThrow()
  })
})
