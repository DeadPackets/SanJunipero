import { describe, expect, it } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import type { Scene } from '../render/scene.js'
import type { Subject } from './anchor.js'
import { PLATE_DROP_PX, platePlaces, platedCast, platedReader, writePlates } from './Nameplate.js'

function body(id: string, name: string): WorldState['agents'][string] {
  return {
    id,
    name,
    x: 0,
    y: 0,
    alive: true,
    asleep: false,
    needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
    hp: 10,
    injuries: [],
    ill: false,
    ageDays: ADULT_AGE_DAYS,
    skills: {},
    activity: null,
    collapsedSinceTick: null,
    zeroHungerSinceTick: null,
  }
}

function town(...ids: [string, string][]): WorldState {
  return {
    ...genesisState(DEFAULT_CONFIG),
    agents: Object.fromEntries(ids.map(([id, name]) => [id, body(id, name)])),
  }
}

/** A camera over an 800x600 window at a stated zoom, and bodies wherever the fixture puts them.
 *  A body missing from `at` is one the map draws nobody for, which is what indoors looks like. */
function camera(
  at: Record<string, { sx: number; sy: number }>,
  view = { x: 0, y: 0, w: 800, h: 600 },
  zoom = 1,
): Scene {
  return {
    viewRect: () => view,
    getZoom: () => zoom,
    pointOf: (kind: string, id: string) => (kind === 'agent' ? (at[id] ?? null) : null),
  } as unknown as Scene
}

const SIZE = () => ({ w: 60, h: 18 })

describe('who wears a nameplate', () => {
  const state = town(['maret', 'Maret'], ['yusuf', 'Yusuf'], ['wren', 'Wren'])

  it('names everybody the camera is framing, by the name the world holds', () => {
    const plates = platedCast(state.agents, ['maret', 'yusuf'], null)
    expect(plates.map((s) => s.name)).toEqual(['Maret', 'Yusuf'])
    expect(plates.every((s) => s.kind === 'agent')).toBe(true)
  })

  it('leaves a body outside the shot bare, so the town is a picture and not a legend', () => {
    const plates = platedCast(state.agents, ['maret', 'yusuf'], null)
    expect(plates.map((s) => s.id)).not.toContain('wren')
  })

  it('gives no plate at all to a cast id the world does not hold', () => {
    const plates = platedCast(state.agents, ['maret', 'ghost'], null)
    expect(plates.map((s) => s.id)).toEqual(['maret'])
  })

  it('keeps the plate on whoever the keyboard is on, and never doubles it', () => {
    const wren: Subject = { id: 'wren', kind: 'agent', name: 'Wren' }
    expect(platedCast(state.agents, ['maret'], wren).map((s) => s.id)).toEqual(['wren', 'maret'])
    expect(platedCast(state.agents, ['wren', 'maret'], wren).map((s) => s.id)).toEqual([
      'wren',
      'maret',
    ])
  })

  it('has nobody to name before the first snapshot', () => {
    expect(platedCast(undefined, ['maret'], null)).toEqual([])
  })

  it('★ names only somebody the world holds, never a word off the roster’s own prototype', () => {
    // `state.agents` is spread off JSON.parse and carries Object.prototype, so a bare read of
    // `constructor` hands back a function and the town wears a plate saying nothing.
    expect(platedCast(state.agents, ['constructor', 'toString'], null)).toEqual([])
  })

  it('★ hands back the same list until a name changes, so a world tick re-renders nothing', () => {
    let world = state
    const read = platedReader(() => world.agents, ['maret', 'yusuf'], null)
    const first = read()
    // the town walks on: every tick is a new state object holding the same two names
    world = town(['maret', 'Maret'], ['yusuf', 'Yusuf'], ['wren', 'Wren'])
    expect(read()).toBe(first)
    world = town(['maret', 'Maret the smith'], ['yusuf', 'Yusuf'])
    const renamed = read()
    expect(renamed).not.toBe(first)
    expect(renamed.map((s) => s.name)).toEqual(['Maret the smith', 'Yusuf'])
  })
})

describe('where the plates go, frame by frame', () => {
  const cast: Subject[] = [
    { id: 'maret', kind: 'agent', name: 'Maret' },
    { id: 'yusuf', kind: 'agent', name: 'Yusuf' },
  ]

  it('follows the bodies as the camera pans', () => {
    const at = { maret: { sx: 400, sy: 300 }, yusuf: { sx: 460, sy: 300 } }
    const first = platePlaces(camera(at), cast, SIZE)
    expect(first.map((p) => p.x)).toEqual([400, 460])
    const panned = platePlaces(camera(at, { x: 100, y: 0, w: 800, h: 600 }), cast, SIZE)
    expect(panned.map((p) => p.x)).toEqual([300, 360])
    expect(panned.every((p) => p.shown)).toBe(true)
  })

  it('hides the plate of a body the map draws nobody for, and takes its box away', () => {
    const places = platePlaces(camera({ maret: { sx: 400, sy: 300 } }), cast, SIZE)
    expect(places[1]!.id).toBe('yusuf')
    expect(places[1]!.shown).toBe(false)
    expect(places[1]!.box).toBeNull()
  })

  it('hides a plate the camera has panned off, so a name never floats at the edge', () => {
    const at = { maret: { sx: 400, sy: 300 }, yusuf: { sx: 4000, sy: 300 } }
    const places = platePlaces(camera(at), cast, SIZE)
    expect(places.map((p) => p.shown)).toEqual([true, false])
  })

  it('never asks the camera anything with nobody to name', () => {
    const dead = {
      viewRect: () => {
        throw new Error('the camera was read for a plate layer with no plates')
      },
      getZoom: () => 1,
    } as unknown as Scene
    expect(platePlaces(dead, [], SIZE)).toEqual([])
  })

  it('drops the box under the body, and shrinks its world footprint as the town zooms in', () => {
    const at = { maret: { sx: 400, sy: 300 }, yusuf: { sx: 460, sy: 300 } }
    const one = platePlaces(camera(at), cast, SIZE)[0]!.box!
    expect(one).toEqual({ x: 400 - 30, y: 300 + PLATE_DROP_PX, w: 60, h: 18 })
    const close = platePlaces(camera(at, { x: 0, y: 0, w: 800, h: 600 }, 2), cast, SIZE)[0]!.box!
    expect(close).toEqual({ x: 400 - 15, y: 300 + PLATE_DROP_PX / 2, w: 30, h: 9 })
  })
})

describe('★ what a frame actually writes to the plates', () => {
  const cast: Subject[] = [
    { id: 'maret', kind: 'agent', name: 'Maret' },
    { id: 'yusuf', kind: 'agent', name: 'Yusuf' },
  ]

  function fakeNodes(): {
    nodeOf: (id: string) => { style: { visibility: string; transform: string } } | undefined
    writes: () => number
  } {
    let writes = 0
    const style = (): { visibility: string; transform: string } => {
      const held = { visibility: '', transform: '' }
      return {
        get visibility() {
          return held.visibility
        },
        set visibility(v: string) {
          writes += 1
          held.visibility = v
        },
        get transform() {
          return held.transform
        },
        set transform(v: string) {
          writes += 1
          held.transform = v
        },
      }
    }
    const nodes = new Map(cast.map((s) => [s.id, { style: style() }]))
    return { nodeOf: (id) => nodes.get(id), writes: () => writes }
  }

  it('★ writes nothing at all on a second frame under a standing camera', () => {
    const at = { maret: { sx: 400, sy: 300 }, yusuf: { sx: 460, sy: 300 } }
    const nodes = fakeNodes()
    const last = new Map<string, { x: number; y: number; shown: boolean }>()
    const still = camera(at)
    writePlates(platePlaces(still, cast, SIZE), nodes.nodeOf, last)
    expect(nodes.writes()).toBe(4)
    for (let i = 0; i < 60; i++) writePlates(platePlaces(still, cast, SIZE), nodes.nodeOf, last)
    expect(nodes.writes()).toBe(4)
  })

  it('follows a body the moment it moves, and leaves the plate beside it alone', () => {
    const nodes = fakeNodes()
    const last = new Map<string, { x: number; y: number; shown: boolean }>()
    const at = { maret: { sx: 400, sy: 300 }, yusuf: { sx: 460, sy: 300 } }
    writePlates(platePlaces(camera(at), cast, SIZE), nodes.nodeOf, last)
    const walked = { maret: { sx: 404, sy: 300 }, yusuf: { sx: 460, sy: 300 } }
    writePlates(platePlaces(camera(walked), cast, SIZE), nodes.nodeOf, last)
    expect(nodes.writes()).toBe(6)
    expect(last.get('maret')?.x).toBe(404)
  })

  it('tells a plate it has gone off screen, and says it once', () => {
    const nodes = fakeNodes()
    const last = new Map<string, { x: number; y: number; shown: boolean }>()
    const gone = { maret: { sx: 400, sy: 300 } }
    writePlates(platePlaces(camera(gone), cast, SIZE), nodes.nodeOf, last)
    expect(last.get('yusuf')?.shown).toBe(false)
    const before = nodes.writes()
    writePlates(platePlaces(camera(gone), cast, SIZE), nodes.nodeOf, last)
    expect(nodes.writes()).toBe(before)
  })
})
