import { describe, expect, it } from 'vitest'
import { Container, type Graphics } from 'pixi.js'
import type { WorldStore } from '../state/worldStore.js'
import { createSceneRing, type SceneRingBounds } from './sceneRing.js'

type TownScene = ReturnType<WorldStore['shotScene']>

/** Where the character layer draws each body. A body missing from it is one the map does not
 *  draw: indoors, or not yet built. */
const STANDING = (): Record<string, { sx: number; sy: number }> => ({
  amara: { sx: 400, sy: 300 },
  nadir: { sx: 460, sy: 330 },
  salma: { sx: 900, sy: 700 },
})

/** The one question the bounds exist to answer: is this body standing on the floor? */
const covers = (b: SceneRingBounds, p: { sx: number; sy: number }): number =>
  ((p.sx - b.sx) / b.rx) ** 2 + ((p.sy - b.sy) / b.ry) ** 2

const talk = (over: Partial<NonNullable<TownScene>> = {}): NonNullable<TownScene> => ({
  id: 's1',
  kind: 'talk',
  participants: ['amara', 'nadir'],
  topic: 'the well',
  stakes: 3,
  open: true,
  ...over,
})

function harness(): {
  ring: ReturnType<typeof createSceneRing>
  say: (scene: TownScene) => void
  at: Record<string, { sx: number; sy: number }>
  node: () => Graphics
} {
  const groundDecal = new Container()
  const at = STANDING()
  let scene: TownScene = null
  const ring = createSceneRing(
    { layers: { groundDecal }, pointOf: (_kind, id) => at[id] ?? null },
    { shotScene: () => scene },
  )
  return {
    ring,
    at,
    say: (s) => {
      scene = s
    },
    node: () => groundDecal.children[0] as Graphics,
  }
}

describe('the floor under a scene', () => {
  it('eases in to full alpha over 320 ms, and is not there before', () => {
    const h = harness()
    h.say(talk())
    h.ring.tick(1000)
    expect(h.ring.alpha()).toBe(0)
    h.ring.tick(1160)
    expect(h.ring.alpha()).toBeGreaterThan(0)
    expect(h.ring.alpha()).toBeLessThan(0.22)
    h.ring.tick(1319)
    expect(h.ring.alpha()).toBeLessThan(0.22)
    h.ring.tick(1320)
    expect(h.ring.alpha()).toBe(0.22)
    expect(h.node().alpha).toBe(1)
    expect(h.node().visible).toBe(true)
  })

  it('eases out on a close, and holds the floor where it stood while it goes', () => {
    const h = harness()
    h.say(talk())
    h.ring.tick(0)
    h.ring.tick(320)
    const stood = h.ring.bounds()!
    h.say(talk({ open: false, summary: 'They agreed.' }))
    h.ring.tick(480)
    h.ring.tick(640)
    expect(h.ring.alpha()).toBeLessThan(0.22)
    expect(h.ring.alpha()).toBeGreaterThan(0)
    expect(h.ring.bounds()).toEqual(stood)
    h.ring.tick(800)
    expect(h.ring.alpha()).toBe(0)
    expect(h.ring.bounds()).toBe(null)
    expect(h.node().visible).toBe(false)
  })

  it('draws nothing for a scene the world never opened, however close two bodies stand', () => {
    const h = harness()
    for (let t = 0; t <= 2000; t += 160) h.ring.tick(t)
    expect(h.ring.bounds()).toBe(null)
    expect(h.ring.alpha()).toBe(0)
    expect(h.node().visible).toBe(false)
  })

  it('covers every member of the cast, however far apart the world holds them', () => {
    const h = harness()
    h.say(talk({ participants: ['amara', 'nadir', 'salma'] }))
    h.ring.tick(0)
    h.ring.tick(320)
    const b = h.ring.bounds()!
    expect(b.sceneId).toBe('s1')
    for (const id of ['amara', 'nadir', 'salma'])
      expect(covers(b, h.at[id]!), id).toBeLessThanOrEqual(1)
  })

  it('follows the cast while they walk', () => {
    const h = harness()
    h.say(talk())
    h.ring.tick(0)
    expect(h.ring.bounds()!.sx).toBe(430)
    h.at.amara = { sx: 500, sy: 300 }
    h.ring.tick(320)
    expect(h.ring.bounds()!.sx).toBe(480)
  })

  // A floor round the one body the map can place claims that body is the scene, which is the
  // opposite of what a ring says. Nothing is the honest picture.
  it('draws no floor at all while the map cannot place every member of the cast', () => {
    const h = harness()
    h.say(talk({ participants: ['amara', 'ghost'] }))
    h.ring.tick(0)
    h.ring.tick(320)
    expect(h.ring.bounds()).toBe(null)
    expect(h.ring.alpha()).toBe(0)
    expect(h.node().visible).toBe(false)
    h.at.ghost = { sx: 460, sy: 300 }
    h.ring.tick(640)
    expect(h.ring.bounds()!.sceneId).toBe('s1')
    expect(h.node().visible).toBe(true)
  })

  it('eases the next scene in instead of teleporting the floor onto its cast', () => {
    const h = harness()
    h.say(talk())
    h.ring.tick(0)
    h.ring.tick(320)
    expect(h.ring.alpha()).toBe(0.22)
    h.say(talk({ id: 's2', participants: ['salma'] }))
    h.ring.tick(320)
    expect(h.ring.alpha(), 'the new floor starts from nothing').toBe(0)
    expect(h.ring.bounds()!.sceneId).toBe('s2')
    h.ring.tick(480)
    const part = h.ring.alpha()
    expect(part).toBeGreaterThan(0)
    expect(part).toBeLessThan(0.22)
    h.ring.tick(640)
    expect(h.ring.alpha()).toBe(0.22)
  })

  it('never reports a lit floor once the graphic is down', () => {
    const h = harness()
    h.say(talk())
    h.ring.tick(0)
    h.ring.tick(320)
    expect(h.ring.alpha()).toBe(0.22)
    delete h.at.nadir
    h.ring.tick(340)
    expect(h.node().visible).toBe(false)
    expect(h.ring.alpha(), 'the number and the picture say the same thing').toBe(0)
  })

  it('takes the floor away when the map draws nobody in the scene any more', () => {
    const h = harness()
    h.say(talk())
    h.ring.tick(0)
    h.ring.tick(320)
    expect(h.node().visible).toBe(true)
    delete h.at.amara
    delete h.at.nadir
    h.ring.tick(480)
    expect(h.ring.bounds()).toBe(null)
    expect(h.node().visible).toBe(false)
  })
})
