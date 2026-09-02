import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY } from '@sj/shared'
import type { TieDelta } from '../scene/scene.js'
import { openAgentDb } from './schema.js'
import { TIE_LET_GO_TICKS, TieStore } from './ties.js'

const AMARA = 'amara'
const YUSUF = 'yusuf'
const OPENED = 4 * MINUTES_PER_DAY

const store = (): TieStore => new TieStore(openAgentDb(':memory:'), AMARA)

const grudge: TieDelta = {
  agentId: AMARA,
  personId: YUSUF,
  kind: 'grudge',
  text: 'He said two planks and brought one.',
}

describe('a tie nobody touches is let go', () => {
  it('closes at seven sim-days and hands the tie back', () => {
    const ties = store()
    ties.apply([grudge], OPENED)
    const gone = ties.letGo(OPENED + TIE_LET_GO_TICKS)
    expect(gone.map((t) => t.text)).toEqual([grudge.text])
    expect(ties.open()).toEqual([])
    expect(ties.all()[0]!.settledTick).toBe(OPENED + TIE_LET_GO_TICKS)
  })

  it('still stands on the sixth day, and lets go of nothing twice', () => {
    const ties = store()
    ties.apply([grudge], OPENED)
    expect(ties.letGo(OPENED + 6 * MINUTES_PER_DAY)).toEqual([])
    expect(ties.open()).toHaveLength(1)
    expect(ties.letGo(OPENED + TIE_LET_GO_TICKS)).toHaveLength(1)
    expect(ties.letGo(OPENED + 2 * TIE_LET_GO_TICKS)).toEqual([])
  })

  it('has no clock for kin, however long nobody speaks', () => {
    const ties = store()
    ties.seedKin([{ id: YUSUF, relation: 'child' }], 0)
    expect(ties.letGo(10 * TIE_LET_GO_TICKS)).toEqual([])
    expect(ties.open().map((t) => t.kind)).toEqual(['kin'])
  })

  it('lets go of one stale tie and leaves the fresh one standing', () => {
    const ties = store()
    ties.apply([grudge], OPENED)
    ties.apply([{ ...grudge, kind: 'promise', text: 'Water from the far well.' }], OPENED + 2000)
    const gone = ties.letGo(OPENED + TIE_LET_GO_TICKS)
    expect(gone.map((t) => t.kind)).toEqual(['grudge'])
    expect(ties.open().map((t) => t.kind)).toEqual(['promise'])
  })
})

describe('kin are ties from the first tick', () => {
  it('writes one per kin in the persona, in the mind’s own words', () => {
    const ties = store()
    ties.seedKin(
      [
        { id: 'leyla', relation: 'partner' },
        { id: 'tariq', relation: 'child' },
      ],
      0,
    )
    expect(ties.open().map((t) => [t.personId, t.kind, t.text, t.source])).toEqual([
      ['leyla', 'kin', 'your partner', 'kin'],
      ['tariq', 'kin', 'your child', 'kin'],
    ])
  })

  it('writes nothing on a second boot, and never claims itself', () => {
    const ties = store()
    const kin = [{ id: 'leyla', relation: 'partner' }]
    ties.seedKin(kin, 0)
    ties.seedKin([...kin, { id: AMARA, relation: 'partner' }], 900)
    expect(ties.all()).toHaveLength(1)
  })
})
