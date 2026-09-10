import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ServerDirector, StakeScore } from '@sj/shared'
import { createWorldStore } from '../state/worldStore.js'
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

// ── what the viewer's own director does with the frame ────────────────────────────────────

describe('★ DirectorMode reads the gateway’s frame, and asks nobody anything', () => {
  it('★ hand-rolls no fetch and polls no endpoint: the cut arrives on the socket', () => {
    expect(SRC).not.toContain('fetch(')
    expect(SRC).not.toContain('/api/heat')
    expect(SRC).not.toContain('useEndpoint')
    expect(SRC).toContain('useSyncExternalStore(store.subscribe, store.getDirector)')
  })

  it('★ keeps the eight-second floor over FRAMES: a gateway that changes its mind is not a cut', () => {
    expect(SRC).toContain('now - lastCutRef.current >= CUT_MIN_MS')
    // the same people with a fresher sentence is the same shot, and lands whatever the clock says
    expect(SRC).toContain('if (keyOf(next) === keyOf(held))')
  })

  it('★ reads indoors off the layer that draws the street', () => {
    expect(SRC).toContain('rendersOnMap')
    expect(SRC).toContain('indoorsIn(state)')
  })

  it('★ a held shot moves the camera nowhere at all', () => {
    expect(SRC).toMatch(/if \(claimBy === 'hold'\) return/)
  })

  it('★ the cut is re-framed every frame, so it follows the room as it shifts', () => {
    expect(SRC).toContain('scene.setZoom(opening.stop)')
    expect(SRC).toMatch(/scene\.setFollow\(\(\) => \{\s*const shot = where\(\)/)
  })

  it('★ the first viewport is the town at zoom 1, centred before the stop moves', () => {
    expect(SRC).toContain('export const OVERVIEW_ZOOM = 1 as const')
    expect(SRC).toMatch(/scene\.centerHome\(\)\s*\n\s*scene\.setZoom\(OVERVIEW_ZOOM\)/)
  })

  // Learned the hard way: a hand on the camera nulls the held cut, the claim falls to 'town',
  // and the branch above ran again, so the first frame of a viewer's own drag was preceded by a
  // jump home at 1x. The opening shot is taken once and never again.
  it('★ standing a claim down moves the camera nowhere at all', () => {
    expect(SRC).toContain('if (!awake || framedRef.current) return')
    expect(SRC).toMatch(/framedRef\.current = true\s*\n\s*scene\.centerHome\(\)/)
  })

  it('★ re-asks the stop when the window crosses the wide breakpoint', () => {
    expect(SRC).toContain("window.addEventListener('resize', stop)")
    expect(SRC).toContain("window.removeEventListener('resize', stop)")
  })

  it('★ a hand on the camera stands the gateway AND the round down, for the same 20s', () => {
    expect(SRC).toContain('autoCut ? (frame?.cut ?? null) : null')
    expect(SRC).toContain('autoCut ? quietSubject(')
  })

  it('★ the caption names the shot the camera is HOLDING, never a frame it has not taken', () => {
    expect(SRC).toContain("const why = claimBy === 'cut' ? (held?.why ?? null) : null")
  })

  it('★ hands the shot on as a string, so a fresh array cannot re-cut the card every tick', () => {
    expect(SRC).toMatch(
      /onShot\?\.\(shotKey === '' \? NO_CAST : shotKey\.split\(' '\), sceneId, isCut\)/,
    )
    expect(SRC).toMatch(/\}, \[shotKey, sceneId, isCut, onShot\]\)/)
    // a quiet-round turn is a shot, but not a cut: the first lines must not go on it
    expect(SRC).toContain("const isCut = claimBy === 'cut' || claimBy === 'moment'")
    // a round turn is a shot too: the caption follows the face the camera moved to
    expect(SRC).toContain("const shotKey = castKey !== '' ? castKey : (followed ?? '')")
  })
})
