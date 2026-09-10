import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorldState } from '@sj/engine/state'
import type { ServerDirector, StakeScore } from '@sj/shared'
import { createWorldStore } from '../state/worldStore.js'
import { tileToScreen } from '../render/iso.js'
import { sceneShot } from '../render/sceneFraming.js'
import {
  DIRECTOR_ZOOM,
  DIRECTOR_ZOOM_WIDE,
  OVERVIEW_ZOOM,
  type ShotCamera,
  WIDE_VIEWPORT_PX,
  driveShot,
} from './DirectorMode.js'
import {
  CUT_MIN_MS,
  QUIET_TURN_TICKS,
  cameraClaim,
  quietSubject,
  townAsleep,
} from './directorCut.js'

const SRC = readFileSync(new URL('./DirectorMode.tsx', import.meta.url), 'utf8')
const NOBODY_INSIDE = new Set<string>()
const NO_MOMENT: readonly string[] = []

const cut = (agentIds: string[], over: Partial<StakeScore> = {}): { cut: StakeScore } => ({
  cut: { sceneId: 'sc_1', agentIds, score: 18, why: 'Nadia & Yusuf — falling out', ...over },
})

// ── the frame on the wire ──────────────────────────────────────────────────────────────────

describe('★ the store keeps the gateway’s last answer, and only its last answer', () => {
  const frame = (over: Partial<ServerDirector> = {}): ServerDirector => ({
    t: 'director',
    tick: 900,
    cut: { sceneId: 'sc_1', agentIds: ['nadia', 'yusuf'], score: 24, why: 'falling out' },
    quiet: false,
    act: 'II',
    ...over,
  })

  it('★ answers nothing at all until a frame has landed', () => {
    expect(createWorldStore().getDirector()).toBeNull()
  })

  it('★ holds the whole frame — the cut, the beat and the act are read off ONE answer', () => {
    const store = createWorldStore()
    expect(store.applyServer(frame())).toBeNull()
    expect(store.getDirector()).toEqual(frame())
    const beat = frame({ cut: null, quiet: true, act: 'III', tick: 910 })
    store.applyServer(beat)
    expect(store.getDirector()).toEqual(beat)
  })

  // The gateway mutes a socket that has left the live edge, so the last live frame stood and
  // aimed the camera at where those people are NOW, under a sentence about a minute the viewer
  // is not watching. A cut is about the live minute or it is about nothing.
  it('★ forgets the live cut the moment the viewer leaves the live edge', () => {
    for (const back of [
      { t: 'scrubbed', reqId: 1, tick: 1, state: {} },
      { t: 'replaying', reqId: 1, tick: 1, seq: 1, state: {} },
    ] as const) {
      const store = createWorldStore()
      store.applyServer(frame())
      expect(store.getDirector()).not.toBeNull()
      store.applyServer(back)
      expect(store.getDirector(), back.t).toBeNull()
    }
  })
})

// ── ★ THE LADDER ──────────────────────────────────────────────────────────────────────────
// Five claimants and one camera. The order is the whole rule, so it is written down here.

describe('★ the camera’s ladder of claims', () => {
  it('★ a viewer following somebody outranks every automation', () => {
    expect(cameraClaim('omar', ['amara'], NOBODY_INSIDE, cut(['nadia']), true, 'salma')).toEqual({
      by: 'pinned',
      agentId: 'omar',
    })
  })

  it('★ a replayed moment outranks the gateway’s cut: the shot is FOR these people', () => {
    expect(cameraClaim(null, ['amara', 'salma'], NOBODY_INSIDE, cut(['nadia']))).toEqual({
      by: 'moment',
      cast: ['amara', 'salma'],
    })
  })

  it('★ the cut takes the camera when nobody nearer has a claim', () => {
    expect(cameraClaim(null, NO_MOMENT, NOBODY_INSIDE, cut(['nadia', 'yusuf']))).toEqual({
      by: 'cut',
      cast: ['nadia', 'yusuf'],
    })
  })

  it('★ nothing scored hands the camera to the quiet round, and then to the town', () => {
    expect(cameraClaim(null, NO_MOMENT, NOBODY_INSIDE, { cut: null }, false, 'omar')).toEqual({
      by: 'round',
      agentId: 'omar',
    })
    expect(cameraClaim(null, NO_MOMENT, NOBODY_INSIDE, { cut: null }, false, null)).toEqual({
      by: 'town',
    })
    expect(cameraClaim(null, NO_MOMENT)).toEqual({ by: 'town' })
  })

  it('★ a cut whose people are all indoors HOLDS rather than cutting to three closed doors', () => {
    const inside = new Set(['nadia', 'yusuf'])
    expect(cameraClaim(null, NO_MOMENT, inside, cut(['nadia', 'yusuf']))).toEqual({ by: 'hold' })
    // and one of them out is a shot: the map can show that much of it
    expect(cameraClaim(null, NO_MOMENT, new Set(['nadia']), cut(['nadia', 'yusuf']))).toEqual({
      by: 'cut',
      cast: ['yusuf'],
    })
  })

  // ★ `shot.ts` has encoded `indoors -> interior` since the grammar was written and nothing ever
  // called it: a council sat in a room while the camera showed the street outside it.
  it('★ a cut wholly inside ONE room is played in that room, not held on the street', () => {
    const inside = new Set(['nadia', 'yusuf'])
    const hall = (id: string): string | null => (inside.has(id) ? 'st_hall' : null)
    expect(
      cameraClaim(null, NO_MOMENT, inside, cut(['nadia', 'yusuf']), false, null, hall),
    ).toEqual({ by: 'interior', structureId: 'st_hall', cast: ['nadia', 'yusuf'] })
  })

  it('★ holds rather than choosing when the cast is indoors in two different rooms', () => {
    const inside = new Set(['nadia', 'yusuf'])
    const apart = (id: string): string => (id === 'nadia' ? 'st_hall' : 'st_house')
    expect(
      cameraClaim(null, NO_MOMENT, inside, cut(['nadia', 'yusuf']), false, null, apart),
    ).toEqual({ by: 'hold' })
    // and a body whose room nobody recorded is not a room to cut to either
    expect(
      cameraClaim(null, NO_MOMENT, inside, cut(['nadia', 'yusuf']), false, null, () => null),
    ).toEqual({ by: 'hold' })
  })

  it('★ one of them out on the street is still a street shot: the map can show that much', () => {
    expect(
      cameraClaim(
        null,
        NO_MOMENT,
        new Set(['nadia']),
        cut(['nadia', 'yusuf']),
        false,
        null,
        () => 'st_hall',
      ),
    ).toEqual({ by: 'cut', cast: ['yusuf'] })
  })

  it('★ a moment whose cast is all indoors holds too, rather than falling to the round', () => {
    expect(cameraClaim(null, ['amara'], new Set(['amara']), { cut: null }, false, 'omar')).toEqual({
      by: 'hold',
    })
  })

  it('★ the quiet round never displaces a cut', () => {
    expect(
      cameraClaim(
        null,
        NO_MOMENT,
        NOBODY_INSIDE,
        { ...cut(['nadia']), quiet: true },
        false,
        'omar',
      ),
    ).toEqual({ by: 'cut', cast: ['nadia'] })
  })

  it('★ a quiet beat is a HELD shot: the round does not turn under it', () => {
    expect(
      cameraClaim(null, NO_MOMENT, NOBODY_INSIDE, { cut: null, quiet: true }, false, 'omar'),
    ).toEqual({ by: 'hold' })
    // ...and the same frame with the beat over hands the camera straight back to the round
    expect(
      cameraClaim(null, NO_MOMENT, NOBODY_INSIDE, { cut: null, quiet: false }, false, 'omar'),
    ).toEqual({ by: 'round', agentId: 'omar' })
  })

  it('★ a sleeping town is a picture of a sleeping town: the bar says so, and no cut under it', () => {
    expect(cameraClaim(null, NO_MOMENT, NOBODY_INSIDE, cut(['nadia']), true, 'omar')).toEqual({
      by: 'town',
    })
    // ...but a viewer who asked to follow somebody, or a moment being replayed, still wins
    expect(cameraClaim('omar', NO_MOMENT, NOBODY_INSIDE, null, true)).toEqual({
      by: 'pinned',
      agentId: 'omar',
    })
    expect(cameraClaim(null, ['amara'], NOBODY_INSIDE, null, true)).toEqual({
      by: 'moment',
      cast: ['amara'],
    })
  })
})

// ── the quiet round ───────────────────────────────────────────────────────────────────────

describe('the televised town always has somebody in front of the camera', () => {
  const TOWN = ['amara', 'omar', 'salma', 'yusuf']

  it('turns one window at a time, and never faster', () => {
    expect(QUIET_TURN_TICKS).toBe(60)
    const seen = Array.from({ length: 8 }, (_, i) => quietSubject(TOWN, i * QUIET_TURN_TICKS))
    expect(seen).toEqual(['amara', 'omar', 'salma', 'yusuf', 'amara', 'omar', 'salma', 'yusuf'])
    // every tick inside one window is the same person: a cut is a decision, not a flicker
    for (let t = 60; t < 120; t++) expect(quietSubject(TOWN, t), `${t}`).toBe('omar')
  })

  it('holds still on a one-person town rather than cutting to the same face', () => {
    for (const t of [0, 59, 60, 1000]) expect(quietSubject(['amara'], t)).toBe('amara')
  })

  it('answers null only when there is nobody left to look at', () => {
    expect(quietSubject([], 1000)).toBeNull()
  })

  it('never indexes off the end on a tick the world has not reached', () => {
    for (const t of [-1, 0, Number.NaN]) expect(TOWN).toContain(quietSubject(TOWN, t))
  })

  it('never cuts faster than the letterboxed floor', () => {
    expect(CUT_MIN_MS).toBe(8000)
  })
})

// ── the night ─────────────────────────────────────────────────────────────────────────────

describe('★ every living body asleep, and not one more', () => {
  const body = (alive: boolean, asleep: boolean) => ({ alive, asleep })

  it('★ is true only when nobody living is up', () => {
    expect(townAsleep({ a: body(true, true), b: body(true, true) })).toBe(true)
    expect(townAsleep({ a: body(true, true), b: body(true, false) })).toBe(false)
  })

  it('★ does not count the dead: a graveyard is not a town keeping watch', () => {
    expect(townAsleep({ a: body(true, true), b: body(false, false) })).toBe(true)
  })

  it('is false for a town with nobody in it at all — there is nothing to say it about', () => {
    expect(townAsleep({})).toBe(false)
    expect(townAsleep({ a: body(false, false) })).toBe(false)
    expect(townAsleep(undefined)).toBe(false)
  })
})

// ── the one thing the file’s own text can answer ──────────────────────────────────────────

describe('★ DirectorMode asks nobody anything: the cut arrives on the socket', () => {
  it('★ hand-rolls no fetch and polls no endpoint', () => {
    expect(SRC).not.toContain('fetch(')
    expect(SRC).not.toContain('/api/heat')
    expect(SRC).not.toContain('useEndpoint')
  })
})

// ── what the camera actually DOES with a claim ────────────────────────────────────────────
//
// Everything below used to be `expect(SRC).toContain(...)` about the text of DirectorMode.tsx,
// and the owner reported director mode as completely broken while every one of them was green.
// A shot is where the camera ended up, so it is taken over a fake rig and read off the picture.

const STAGE_BOX = { w: 1280, h: 720 }
const FRAMED = { current: true }
const NO_WORLD = { getState: (): null => null }

/** A rig that remembers where it is, what it was asked in what order, and the follow tick the
 *  real camera runs every frame. */
function rig(
  points: Map<string, { sx: number; sy: number }>,
  anchors = new Map<string, { x: number; y: number }>(),
) {
  const cam = { x: 137, y: -42, scale: 3 }
  const asked: string[] = []
  let follow: (() => { x: number; y: number } | null) | null = null
  const scene: ShotCamera = {
    app: { screen: { width: STAGE_BOX.w, height: STAGE_BOX.h } },
    setZoom(stop) {
      asked.push('zoom')
      cam.scale = stop
    },
    setFollow(target) {
      follow = target
    },
    centerHome() {
      asked.push('home')
      cam.x = 0
      cam.y = 0
    },
    pointOf: (_kind, id) => points.get(id) ?? null,
    anchorOf: (id) => anchors.get(id) ?? null,
  }
  const tick = (): void => {
    const p = follow?.() ?? null
    if (p === null) return
    cam.x = p.x
    cam.y = p.y
  }
  return { scene, cam, asked, tick }
}

/** The window the stop is a function of, with its resize listeners in hand. */
function stubWindow(width: number) {
  const bound = new Set<() => void>()
  const win = {
    innerWidth: width,
    addEventListener: (_type: string, fn: () => void) => void bound.add(fn),
    removeEventListener: (_type: string, fn: () => void) => void bound.delete(fn),
  }
  vi.stubGlobal('window', win)
  return {
    resize(to: number) {
      win.innerWidth = to
      for (const fn of [...bound]) fn()
    },
    listeners: (): number => bound.size,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('★ the shot a claim takes, over a fake rig and a fake clock', () => {
  it('★ re-frames the cut on every tick, so the shot follows the room as it shifts', () => {
    const points = new Map([
      ['nadia', { sx: 900, sy: 500 }],
      ['yusuf', { sx: 964, sy: 532 }],
    ])
    const { scene, cam, tick } = rig(points)
    driveShot(
      scene,
      NO_WORLD,
      { by: 'cut', castKey: 'nadia yusuf', followed: null, structureId: null, awake: true },
      FRAMED,
    )
    tick()
    const opening = sceneShot([...points.values()], STAGE_BOX)
    expect(opening).not.toBeNull()
    expect(cam).toEqual({ x: opening?.sx, y: opening?.sy, scale: opening?.stop })
    points.set('yusuf', { sx: 1500, sy: 900 })
    tick()
    const moved = sceneShot([...points.values()], STAGE_BOX)
    expect(moved?.sx).not.toBe(opening?.sx)
    expect(cam, 'the shot was framed once and never again').toMatchObject({
      x: moved?.sx,
      y: moved?.sy,
    })
  })

  it('★ centres the town before the stop moves, so the opening zoom eases about the middle', () => {
    const { scene, cam, asked } = rig(new Map())
    driveShot(
      scene,
      NO_WORLD,
      { by: 'town', castKey: '', followed: null, structureId: null, awake: true },
      { current: false },
    )
    expect(asked).toEqual(['home', 'zoom'])
    expect(cam).toEqual({ x: 0, y: 0, scale: OVERVIEW_ZOOM })
  })

  it('★ follows the body itself: the sprite where the layer drew one, the tile where it did not', () => {
    stubWindow(WIDE_VIEWPORT_PX)
    const anchors = new Map([['ada', { x: 900, y: 500 }]])
    const world = { getState: () => ({ agents: { ada: { x: 4, y: 6 } } }) as unknown as WorldState }
    const { scene, cam, tick } = rig(new Map(), anchors)
    driveShot(
      scene,
      world,
      { by: 'round', castKey: '', followed: 'ada', structureId: null, awake: true },
      FRAMED,
    )
    tick()
    expect(cam).toMatchObject({ x: 900, y: 500 })
    anchors.clear()
    tick()
    const tile = tileToScreen(4, 6)
    expect(cam).toMatchObject({ x: tile.sx, y: tile.sy })
  })

  it('★ re-asks the stop when the window crosses the wide breakpoint, and lets go on the way out', () => {
    const win = stubWindow(WIDE_VIEWPORT_PX)
    const { scene, cam } = rig(new Map(), new Map([['ada', { x: 0, y: 0 }]]))
    const off = driveShot(
      scene,
      NO_WORLD,
      { by: 'round', castKey: '', followed: 'ada', structureId: null, awake: true },
      FRAMED,
    )
    expect(cam.scale).toBe(DIRECTOR_ZOOM_WIDE)
    win.resize(WIDE_VIEWPORT_PX - 1)
    expect(cam.scale).toBe(DIRECTOR_ZOOM)
    off?.()
    expect(win.listeners()).toBe(0)
    win.resize(WIDE_VIEWPORT_PX)
    expect(cam.scale, 'a shot that ended is still driving the camera').toBe(DIRECTOR_ZOOM)
  })
})
