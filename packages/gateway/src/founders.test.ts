import { describe, expect, it } from 'vitest'
import { RngStreams, doorTile, fold, genesisState, makeFixtureMap } from '@sj/engine'
import type { WorldState } from '@sj/engine'
import { SHOWCASE_CONFIG } from './devWorld.js'
import {
  FOUNDERS_HOME_ID, GO_HOME_BELOW, LEAVE_HOME_ABOVE, homeIntent, makeFoundersOnTick,
} from './founders.js'

// The dev world after its first tick: five founders, six finished buildings.
function townAtTick1(): WorldState {
  let state = genesisState(SHOWCASE_CONFIG, makeFixtureMap())
  const events: Array<{ type: string; payload: unknown }> = []
  const onTick = makeFoundersOnTick(SHOWCASE_CONFIG, new RngStreams('founders-test'), () => state)
  onTick({ tick: 1, emit: (type, payload) => events.push({ type, payload }) })
  let seq = 0
  for (const e of events) state = fold(state, { seq: ++seq, tick: 1, ...e }, SHOWCASE_CONFIG)
  return state
}

const spend = (state: WorldState, id: string, energy: number): WorldState => ({
  ...state,
  agents: { ...state.agents, [id]: { ...state.agents[id]!, needs: { ...state.agents[id]!.needs, energy } } },
})

const putAt = (state: WorldState, id: string, x: number, y: number): WorldState => ({
  ...state,
  agents: { ...state.agents, [id]: { ...state.agents[id]!, x, y } },
})

const putInside = (state: WorldState, id: string, structureId: string): WorldState => ({
  ...state,
  agents: { ...state.agents, [id]: { ...state.agents[id]!, insideId: structureId } },
})

describe('homeIntent', () => {
  const base = townAtTick1()
  const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!

  it('leaves a rested founder to the patrol', () => {
    expect(homeIntent(spend(base, 'omar', 90), 'omar')).toBeNull()
    expect(homeIntent(spend(base, 'omar', GO_HOME_BELOW), 'omar')).toBeNull()
  })

  it('walks a spent founder to the door of the one dwelling', () => {
    const s = putAt(spend(base, 'omar', 10), 'omar', 6, 32)
    expect(homeIntent(s, 'omar')).toEqual({ verb: 'walk', params: { x: door.x, y: door.y } })
  })

  it('goes in once the founder is standing at the door', () => {
    const s = putAt(spend(base, 'omar', 10), 'omar', door.x, door.y)
    expect(homeIntent(s, 'omar')).toEqual({ verb: 'enter', params: { structureId: FOUNDERS_HOME_ID } })
  })

  it('sleeps indoors, then comes out again once rested', () => {
    const inside = putInside(base, 'omar', FOUNDERS_HOME_ID)
    expect(homeIntent(spend(inside, 'omar', 10), 'omar')).toEqual({ verb: 'sleep', params: {} })
    expect(homeIntent(spend(inside, 'omar', LEAVE_HOME_ABOVE + 1), 'omar')).toEqual({ verb: 'exit', params: {} })
  })

  it('says nothing about someone who is not there', () => {
    expect(homeIntent(base, 'nobody')).toBeNull()
  })
})

describe('makeFoundersOnTick interiors switch', () => {
  const spent = (): WorldState => {
    const base = townAtTick1()
    const door = doorTile(base, base.structures[FOUNDERS_HOME_ID]!)!
    let s = base
    for (const id of Object.keys(base.agents)) s = spend(s, id, 5)
    return putAt(s, 'omar', door.x, door.y)
  }

  // `enter` is a timed verb: the tick that accepts it emits action_started, and
  // agent_entered lands when the action completes.
  const verbsStarted = (interiors: boolean): string[] => {
    const state = spent()
    const out: string[] = []
    const onTick = makeFoundersOnTick(
      SHOWCASE_CONFIG, new RngStreams('founders-test'), () => state, { interiors },
    )
    onTick({
      tick: 2,
      emit: (type, payload) => {
        if (type !== 'action_started') return
        const p = payload as { agentId: string; verb: string }
        if (p.agentId === 'omar') out.push(p.verb)
      },
    })
    return out
  }

  it('is OFF by default — no gate\'s world folds an event it did not fold before', () => {
    expect(verbsStarted(false)).not.toContain('enter')
  })

  it('sends a spent founder through the door when it is on', () => {
    expect(verbsStarted(true)).toContain('enter')
  })
})
