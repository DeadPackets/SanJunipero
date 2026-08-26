// A turned 2x2 house is byte-identical to an unturned one, so facing cannot be inferred from
// w/h — structure_planned has to carry it, and a renderer holding one structure needs it.
import { describe, expect, it } from 'vitest'
import {
  SimConfigSchema,
  T_ROAD,
  doorFrontOf,
  grammarOf,
  type SimConfig,
  type TownClaim,
  type TownFacing,
} from '@sj/shared'
import { fold } from './fold.js'
import { genesisState, type Structure, type WorldState } from './state.js'
import { makeGenesisWorld } from './genesis/world.js'
import { submitIntent } from './intent.js'
import { claimInWorld, townSquareOf } from './town.js'

const CFG: SimConfig = SimConfigSchema.parse({ construction: { houseTicks: 1 } })
const BUILDER = 'b1'

let seq = 50_000
const ev = (type: string, payload: unknown) => ({ seq: seq++, tick: 1, type, payload })
const apply = (s: WorldState, events: { type: string; payload: unknown }[]): WorldState =>
  events.reduce((acc, e) => fold(acc, ev(e.type, e.payload) as never, CFG), s)

/** A genesis world with one builder standing in the square and planks enough for the town. */
function world(): WorldState {
  const { terrain, events } = makeGenesisWorld(CFG)
  let s = apply(genesisState(CFG, terrain), events)
  const sq = townSquareOf(s)!
  s = apply(s, [
    { type: 'agent_spawned', payload: { id: BUILDER, name: 'B', x: sq.x, y: sq.y, ageDays: 7300 } },
  ])
  return apply(s, [
    {
      type: 'item_spawned',
      payload: { id: 'item_wood_b1', kind: 'wood', qty: 9999, loc: { t: 'agent', id: BUILDER } },
    },
  ])
}

/** onStart sets the hands going and only a TickLoop puts them down; these helpers fold events by
 *  hand, so the body is set idle between builds. Nothing about WHERE a house goes reads the activity. */
const idle = (s: WorldState): WorldState => ({
  ...s,
  agents: { ...s.agents, [BUILDER]: { ...s.agents[BUILDER]!, activity: null } },
})

/** Raise houses until the NEXT claim faces `want`, and hand back the world just before it. */
function raiseUntilFacing(want: TownFacing): { state: WorldState; claim: TownClaim } | null {
  let s = world()
  for (let i = 0; i < 40; i++) {
    const claim = claimInWorld(s, { along: 2, deep: 2 })
    if (claim === null) return null
    if (claim.facing === want) return { state: s, claim }
    s = { ...s, agents: { ...s.agents, [BUILDER]: { ...s.agents[BUILDER]!, ...claim.door } } }
    const r = submitIntent(s, CFG, BUILDER, 'build', { kind: 'house' })
    if (!r.ok) return null
    const before = new Set(Object.keys(s.structures))
    s = apply(s, r.events)
    const id = Object.keys(s.structures).find((k) => !before.has(k))
    if (id === undefined) return null
    s = apply(s, [{ type: 'structure_completed', payload: { id } }])
    s = idle(s)
  }
  return null
}

/** Raise houses on claimed plots until one of them is a plot the town TURNS, and return the
 *  world, that structure and the facing the claim decided. `null` if the town never turns one. */
function raiseUntilTurned(): { state: WorldState; built: Structure; facing: TownFacing } | null {
  let s = world()
  for (let i = 0; i < 40; i++) {
    const claim = claimInWorld(s, { along: 2, deep: 2 })
    if (claim === null) break
    // Stand at the door, then build with `{kind}` and nothing else — the real seam.
    s = { ...s, agents: { ...s.agents, [BUILDER]: { ...s.agents[BUILDER]!, ...claim.door } } }
    const r = submitIntent(s, CFG, BUILDER, 'build', { kind: 'house' })
    if (!r.ok) break
    const before = new Set(Object.keys(s.structures))
    s = apply(s, r.events)
    const id = Object.keys(s.structures).find((k) => !before.has(k))
    if (id === undefined) break
    s = apply(s, [{ type: 'structure_completed', payload: { id } }])
    s = idle(s)
    if (claim.facing !== 'sw') return { state: s, built: s.structures[id]!, facing: claim.facing }
  }
  return null
}

describe('★ an agent-built house knows which way it faces', () => {
  const turned = raiseUntilTurned()

  it('the town does turn houses, so this question is not hypothetical', () => {
    expect(turned, 'no plot in forty builds seated a house any way but sw').not.toBeNull()
    expect(turned!.facing).toBe('se')
    // and the footprint cannot tell you: a turned 2x2 is byte-identical to an unturned one
    expect(turned!.built.w).toBe(turned!.built.h)
  })

  it('★ AND ITS DRAWN FACE AGREES WITH THE PLOT IT SITS ON — read off the state, nothing else', () => {
    const { state, built, facing } = turned!
    expect(built.facing, 'the world forgot which way the plot seated it').toBe(facing)
    // The whole point of carrying it: the door can be found from ONE structure, the way a
    // renderer holds one, with no town-wide recomputation.
    const square = townSquareOf(state)!
    const g = grammarOf(square, { x: built.x, y: built.y })
    const front = doorFrontOf({ dx: g.dx, dy: g.dy, w: built.w, h: built.h, facing: built.facing! })
    const at = { x: square.x + front.dx, y: square.y + front.dy }
    expect(state.terrain[at.y]?.[at.x], `the door opens onto ${at.x},${at.y}`).toBe(T_ROAD)
  })

  it('★ and the default is still SW, unwritten — so no world that never turns one moves', () => {
    // The same convention `forge/buildingArt.facingKind` already uses: the bare kind IS sw.
    // It is what keeps every landed gate hashing the world it always hashed.
    const found = raiseUntilFacing('sw')
    expect(found, 'the town never seated a house sw').not.toBeNull()
    const { state: s, claim } = found!
    const at = {
      ...s,
      agents: { ...s.agents, [BUILDER]: { ...s.agents[BUILDER]!, ...claim.door } },
    }
    const r = submitIntent(at, CFG, BUILDER, 'build', { kind: 'house' })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    const planned = (
      r as { events: { type: string; payload: Record<string, unknown> }[] }
    ).events.find((e) => e.type === 'structure_planned')!
    expect(
      Object.keys(planned.payload),
      'a facing was written for a house that is not turned',
    ).not.toContain('facing')
    expect(
      apply(at, (r as { events: { type: string; payload: unknown }[] }).events).structures[
        String(planned.payload.id)
      ]!.facing,
    ).toBeUndefined()
  })

  it('★ and NE and NW stay unrepresentable — the schema knows two facings and no more', () => {
    const s = world()
    const claim = claimInWorld(s, { along: 2, deep: 2 })!
    const at = {
      ...s,
      agents: { ...s.agents, [BUILDER]: { ...s.agents[BUILDER]!, ...claim.door } },
    }
    const r = submitIntent(at, CFG, BUILDER, 'build', { kind: 'house' })
    const planned = (
      r as { events: { type: string; payload: Record<string, unknown> }[] }
    ).events.find((e) => e.type === 'structure_planned')!
    for (const bad of ['ne', 'nw', 'north', '']) {
      expect(
        () =>
          apply(at, [
            { type: 'structure_planned', payload: { ...planned.payload, id: 'x', facing: bad } },
          ]),
        `${bad} was accepted as a facing`,
      ).toThrow()
    }
  })
})
