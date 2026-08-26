import { describe, it, expect } from 'vitest'
import { RngStream, RngStreams } from './rng.js'

describe('RngStream', () => {
  it('same seed+name → identical sequence', () => {
    const a = RngStream.seed('town1', 'weather'),
      b = RngStream.seed('town1', 'weather')
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })
  it('different stream names diverge', () => {
    const a = RngStream.seed('town1', 'weather'),
      b = RngStream.seed('town1', 'combat')
    expect(a.next()).not.toBe(b.next())
  })
  it('serialize/restore continues the sequence exactly', () => {
    const a = RngStream.seed('town1', 'crops')
    a.next()
    a.next()
    const resumed = RngStream.from(a.state())
    expect(resumed.next()).toBe(a.next())
  })
  it('int(n) is in [0, n)', () => {
    const a = RngStream.seed('s', 'x')
    for (let i = 0; i < 1000; i++) {
      const v = a.int(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })
})

describe('RngStreams', () => {
  it('snapshot/restore round-trips all streams', () => {
    const s = new RngStreams('town1')
    s.get('weather').next()
    s.get('combat').next()
    s.get('combat').next()
    const r = RngStreams.restore(s.snapshot())
    expect(r.get('combat').next()).toBe(s.get('combat').next())
    expect(r.get('weather').next()).toBe(s.get('weather').next())
  })
  it('restore preserves the seed for streams absent from the snapshot', () => {
    const s = new RngStreams('town1')
    s.get('weather').next()
    const r = RngStreams.restore(s.snapshot())
    const fresh = new RngStreams('town1')
    expect([r.get('never-touched').next(), r.get('never-touched').next()]).toEqual([
      fresh.get('never-touched').next(),
      fresh.get('never-touched').next(),
    ])
  })
})
