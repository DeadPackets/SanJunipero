import { describe, expect, it } from 'vitest'
import { BODY_TERMS, type SimEvent } from '@sj/shared'
import { CUE_TYPES } from '../ui/stageCue.js'
import { BEATS, beatFor, beatScale } from './beats.js'

// One frame of the town's own clock, so a trace is what a viewer would actually be shown.
const FRAME_MS = 16

/** Every scale the body under this event is drawn at, frame by frame, until it is back at rest. */
const trace = (ev: SimEvent): number[] => {
  const name = beatFor(ev.type)
  if (name === null) return []
  const out: number[] = []
  for (let ms = 0; ms < 1200; ms += FRAME_MS) out.push(beatScale(name, ms) ?? 1)
  return out
}

const ev = (type: string, payload: Record<string, unknown>): SimEvent =>
  ({ type, tick: 4, payload }) as unknown as SimEvent

// The real payloads, off `events.def.ts`: a child arrives with its mother, a parting names the
// one who ended it, and a plank is an item with a kind and a count.
const BIRTH = ev('agent_born', {
  id: 'ife',
  name: 'Ife',
  sex: 'f',
  motherId: 'amara',
  fatherId: 'yusuf',
  x: 3,
  y: 4,
})
const DEATH = ev('agent_died', { agentId: 'nadia', cause: 'age' })
const PARTING = ev('partnership_dissolved', { aId: 'amara', bId: 'yusuf', byId: 'amara' })
const DISCOVERY = ev('discovery_made', { agentId: 'omar', kind: 'rope' })
const PLANK = ev('item_spawned', {
  id: 'item_9',
  kind: 'wood',
  qty: 1,
  loc: { t: 'agent', id: 'omar' },
})
const HOUSE = ev('structure_completed', { id: 'house_2' })

describe('★ the beat table says that something mattered', () => {
  it('★ draws a birth, a parting and a dropped plank three different ways', () => {
    const [birth, parting, plank] = [trace(BIRTH), trace(PARTING), trace(PLANK)]
    expect(birth).not.toEqual(parting)
    expect(birth).not.toEqual(plank)
    expect(parting).not.toEqual(plank)
    // and the difference is one a viewer can see, not a rounding one
    expect(Math.max(...birth) - Math.max(...plank)).toBeGreaterThan(0.15)
    expect(Math.max(...parting)).toBeGreaterThan(Math.max(...plank))
  })

  it('★ draws a death with nothing at all: no body is left standing to carry it', () => {
    expect(beatFor(DEATH.type)).toBeNull()
    expect(trace(DEATH)).toEqual([])
  })

  it('gives every class of moment its own shape, and all five are reachable', () => {
    const shapes = [BIRTH, PARTING, DISCOVERY, PLANK, HOUSE].map((e) => beatFor(e.type))
    expect([...shapes].sort()).toEqual(['beat', 'flick', 'settle', 'swell', 'tap'])
  })

  it('lasts longer the more it mattered, and a plank is the shortest thing on screen', () => {
    const ms = (e: SimEvent): number => BEATS[beatFor(e.type)!].ms
    expect(ms(BIRTH)).toBeGreaterThan(ms(PARTING))
    expect(ms(PARTING)).toBeGreaterThan(ms(DISCOVERY))
    expect(ms(DISCOVERY)).toBeGreaterThan(ms(PLANK))
  })

  it('ranks off BODY_TERMS and holds no opinion of its own', () => {
    // A departure and a parting are both 14: the world says they weigh the same, so we do.
    expect(BODY_TERMS.agent_departed).toBe(BODY_TERMS.partnership_dissolved)
    expect(beatFor('agent_departed')).toBe(beatFor('partnership_dissolved'))
    // ...and a discovery outranks a broken rule there, so it outranks it here too.
    expect(BODY_TERMS.discovery_made!).toBeGreaterThan(BODY_TERMS.law_broken!)
    expect(BEATS[beatFor('discovery_made')!].peak).toBeGreaterThan(
      BEATS[beatFor('law_broken')!].peak,
    )
  })

  it('has a shape for every moment the stage can say, so nothing falls through', () => {
    for (const type of [...CUE_TYPES, 'item_spawned']) {
      if (type === 'agent_died') continue
      expect(BEATS[beatFor(type)!], type).toBeDefined()
    }
  })

  it('starts and ends at rest, so nothing is left stuck at a scale', () => {
    for (const name of Object.keys(BEATS) as (keyof typeof BEATS)[]) {
      expect(beatScale(name, 0), name).toBeCloseTo(name === 'settle' ? BEATS.settle.peak : 1, 6)
      expect(beatScale(name, BEATS[name].ms), name).toBeNull()
      expect(beatScale(name, -1), name).toBeNull()
    }
  })

  it('a finished building lands under its own weight instead of rising to meet you', () => {
    const house = trace(HOUSE)
    expect(house[0]).toBeGreaterThan(1)
    expect(Math.min(...house), 'it squashes on the way down').toBeLessThan(1)
    expect(
      trace(BIRTH).every((k) => k >= 1),
      'a body only ever rises',
    ).toBe(true)
  })
})
