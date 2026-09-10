import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sceneShot } from '../render/sceneFraming.js'
import type { StakeScore } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { PEAK_PUSH_MS, type Shot, takeShot } from './shot.js'
import { OVERVIEW_ZOOM, type ShotCamera, driveShot, shotOf } from './DirectorMode.js'

const STAGE_BOX = { w: 1280, h: 720 }

/** A camera that remembers where it IS, with the rig's own follow tick as one function: what a
 *  shot did to the picture is the thing a test of the director has to be able to read. */
function fakeCamera(points: Readonly<Record<string, { sx: number; sy: number }>> = {}) {
  const cam = { x: 137, y: -42, scale: 3 }
  let follow: (() => { x: number; y: number } | null) | null = null
  let room: string | null = null
  const rig: ShotCamera = {
    interior: {
      setActive(structureId) {
        room = structureId
      },
      activeId: () => room,
      setFollowed() {},
      isActive: () => room !== null,
      onChange: () => () => {},
      destroy() {},
    },
    app: { screen: { width: STAGE_BOX.w, height: STAGE_BOX.h } },
    setZoom(stop) {
      cam.scale = stop
    },
    setFollow(target) {
      follow = target
    },
    centerHome() {
      cam.x = 0
      cam.y = 0
    },
    pointOf: (_kind, id) => points[id] ?? null,
  }
  const tick = (): void => {
    const p = follow?.() ?? null
    if (p === null) return
    cam.x = p.x
    cam.y = p.y
  }
  return {
    rig,
    cam,
    tick,
    following: (): boolean => follow !== null,
    room: (): string | null => room,
    enter: (id: string): void => {
      room = id
    },
  }
}

const NO_WORLD = { getState: () => null }
const RELEASED = {
  by: 'town' as const,
  castKey: '',
  followed: null,
  structureId: null,
  awake: true,
}

// The camera, the caption, the card and the thought gate all follow ONE answer. It used to be
// six expressions inside a React component, which is why nothing could read them.
describe('what the shot is OF', () => {
  const HELD: StakeScore = {
    sceneId: 'sc_1',
    agentIds: ['nadia', 'yusuf'],
    score: 18,
    why: 'Nadia and Yusuf are falling out',
  }

  it('★ names the cast, the scene and the gateway’s own sentence for a cut', () => {
    expect(shotOf({ by: 'cut', cast: ['nadia', 'yusuf'] }, HELD)).toEqual({
      castKey: 'nadia yusuf',
      followed: null,
      sceneId: 'sc_1',
      shotKey: 'nadia yusuf',
      isCut: true,
      why: 'Nadia and Yusuf are falling out',
    })
  })

  it('★ carries the same answer out of a room: an interior IS the gateway’s cut', () => {
    expect(
      shotOf({ by: 'interior', structureId: 'st_hall', cast: ['nadia', 'yusuf'] }, HELD),
    ).toMatchObject({ castKey: 'nadia yusuf', sceneId: 'sc_1', isCut: true, why: HELD.why })
  })

  // ★ A caption off the live cut over a minute nobody is watching describes people who are not
  // in the picture, so a replayed moment takes its cast and none of the gateway's words.
  it('★ gives a replayed moment its cast and NONE of the live cut’s words', () => {
    expect(shotOf({ by: 'moment', cast: ['amara'] }, HELD)).toEqual({
      castKey: 'amara',
      followed: null,
      sceneId: null,
      shotKey: 'amara',
      isCut: true,
      why: null,
    })
  })

  it('follows the face a turn moved to, and calls it no cut', () => {
    for (const claim of [
      { by: 'round' as const, agentId: 'omar' },
      { by: 'pinned' as const, agentId: 'omar' },
    ]) {
      expect(shotOf(claim, HELD), claim.by).toEqual({
        castKey: '',
        followed: 'omar',
        sceneId: null,
        shotKey: 'omar',
        isCut: false,
        why: null,
      })
    }
  })

  it('names nobody at all while the shot holds or the town stands', () => {
    for (const claim of [{ by: 'hold' as const }, { by: 'town' as const }]) {
      expect(shotOf(claim, HELD), claim.by).toEqual({
        castKey: '',
        followed: null,
        sceneId: null,
        shotKey: '',
        isCut: false,
        why: null,
      })
    }
  })
})

describe('★ standing down means the camera STOPS', () => {
  // ★ The worst single moment in the product: a viewer drags, the director's claim is released,
  // and the release ran centerHome plus zoom 1, so the camera jumped home under the drag itself.
  it('★ leaves x, y and the scale exactly where the hand left them', () => {
    const { rig, cam, tick } = fakeCamera({ ada: { sx: 900, sy: 500 } })
    // Framed the way a session reaches it: a shot went out, and a hand has been on the lens
    // since. Hand-setting `framed` here seeded a state the app was once unable to reach.
    const framed = { current: false }
    driveShot(
      rig,
      NO_WORLD,
      { by: 'cut', castKey: 'ada', followed: null, structureId: null, awake: true },
      framed,
    )?.()
    cam.x = 137
    cam.y = -42
    cam.scale = 3
    const before = { ...cam }
    const off = driveShot(rig, NO_WORLD, RELEASED, framed)
    tick()
    expect(cam).toEqual(before)
    expect(off).toBeUndefined()
  })

  it('★ frames the town for the opening shot and never again', () => {
    const { rig, cam } = fakeCamera()
    const framed = { current: false }
    driveShot(rig, NO_WORLD, RELEASED, framed)
    expect(cam).toEqual({ x: 0, y: 0, scale: OVERVIEW_ZOOM })
    expect(framed.current).toBe(true)
    cam.x = 500
    cam.y = 600
    cam.scale = 2
    driveShot(rig, NO_WORLD, RELEASED, framed)
    expect(cam).toEqual({ x: 500, y: 600, scale: 2 })
  })

  it('has no opening shot to take until there is a town', () => {
    const { rig, cam } = fakeCamera()
    const framed = { current: false }
    const before = { ...cam }
    driveShot(rig, NO_WORLD, { ...RELEASED, awake: false }, framed)
    expect(cam).toEqual(before)
    expect(framed.current).toBe(false)
  })

  it('drops the follow when the shot ends, so nothing is still tracking the last face', () => {
    const { rig, following } = fakeCamera({ ada: { sx: 900, sy: 500 } })
    const off = driveShot(
      rig,
      NO_WORLD,
      { by: 'cut', castKey: 'ada', followed: null, structureId: null, awake: true },
      { current: true },
    )
    expect(following()).toBe(true)
    off?.()
    expect(following()).toBe(false)
  })
})

// ★ The release branch was the only writer of `framed`, so a viewer whose session opened on a
// cut or a round turn still had it false: the next released claim threw the town home under the
// hand that was dragging it. The owner called that the worst moment in the product.
describe('★ the town is framed ONCE, by whatever shot got there first', () => {
  // A follow asks the window for its stop, and this test runs off a browser.
  beforeEach(() => {
    vi.stubGlobal('window', { innerWidth: 1280, addEventListener() {}, removeEventListener() {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const shots = [
    { by: 'cut' as const, castKey: 'ada', followed: null, structureId: null, awake: true },
    { by: 'round' as const, castKey: '', followed: 'ada', structureId: null, awake: true },
    { by: 'interior' as const, castKey: 'ada', followed: null, structureId: 'st_1', awake: true },
  ]

  for (const shot of shots) {
    it(`★ never throws the town home after a ${shot.by} shot`, () => {
      const { rig, cam } = fakeCamera({ ada: { sx: 900, sy: 500 } })
      const framed = { current: false }
      driveShot(rig, NO_WORLD, shot, framed)?.()
      cam.x = 500
      cam.y = 600
      cam.scale = 2
      driveShot(rig, NO_WORLD, RELEASED, framed)
      expect(cam, 'the town was thrown home under the hand').toEqual({ x: 500, y: 600, scale: 2 })
      expect(framed.current).toBe(true)
    })
  }

  it('is not framed by a shot taken before there is a town to frame', () => {
    const { rig } = fakeCamera()
    const framed = { current: false }
    driveShot(
      rig,
      NO_WORLD,
      { by: 'cut', castKey: 'ada', followed: null, structureId: null, awake: false },
      framed,
    )
    expect(framed.current).toBe(false)
  })
})

// ★ A council sits indoors and the exterior view draws three closed doors. The interior renderer
// has always existed; the director had never once asked it for a shot.
describe('★ a cut nobody can see from the street is played in the room', () => {
  const COUNCIL = {
    by: 'interior' as const,
    castKey: 'ada bo',
    followed: null,
    structureId: 'st_hall',
    awake: true,
  }

  it('★ puts the camera in the room, and gives the town back when the shot ends', () => {
    const { rig, room } = fakeCamera()
    const off = driveShot(rig, NO_WORLD, COUNCIL, { current: true })
    expect(room()).toBe('st_hall')
    off?.()
    expect(room()).toBeNull()
  })

  it('takes nobody on the street with it: the bodies it wants are not drawn there', () => {
    const { rig, cam, tick, following } = fakeCamera()
    const before = { ...cam }
    driveShot(rig, NO_WORLD, COUNCIL, { current: true })
    tick()
    expect(following()).toBe(false)
    expect(cam).toEqual(before)
  })

  it('★ never takes a room out of a viewer’s hands, and leaves the one they opened', () => {
    const { rig, room, enter } = fakeCamera()
    enter('st_house')
    const off = driveShot(rig, NO_WORLD, COUNCIL, { current: true })
    expect(room()).toBe('st_house')
    off?.()
    expect(room()).toBe('st_house')
  })
})

describe('the director still takes a shot when it has one', () => {
  const CAST = { ada: { sx: 900, sy: 500 }, bo: { sx: 964, sy: 532 } }

  it('puts the camera on the cast, at the stop the framing asked for', () => {
    const { rig, cam, tick } = fakeCamera(CAST)
    driveShot(
      rig,
      NO_WORLD,
      { by: 'cut', castKey: 'ada bo', followed: null, structureId: null, awake: true },
      {
        current: true,
      },
    )
    tick()
    // The framing written out rather than asked for: two bodies 64 by 32 apart, a tile and a
    // half of ground round them, is 932,516 — and 160 by 80 world px fits a 1280 stage at 3.
    expect(cam).toEqual({ x: 932, y: 516, scale: 3 })
    const shot = sceneShot([CAST.ada, CAST.bo], STAGE_BOX)
    expect(shot).not.toBeNull()
    expect(cam).toEqual({ x: shot?.sx, y: shot?.sy, scale: shot?.stop })
  })

  it('holds where it is for a claim the exterior view cannot show', () => {
    const { rig, cam, tick, following } = fakeCamera(CAST)
    const before = { ...cam }
    const off = driveShot(
      rig,
      NO_WORLD,
      { by: 'hold', castKey: '', followed: null, structureId: null, awake: true },
      {
        current: true,
      },
    )
    tick()
    expect(cam).toEqual(before)
    expect(following()).toBe(false)
    expect(off).toBeUndefined()
  })
})

// ★ The owner's defect had one door left open: `driveShot` returned for a HOLD before it wrote
// `framed`, so a session whose first claim was a hold — the whole cast indoors, or a quiet beat —
// still had `framed` false when the viewer's first drag released the claim, and the town jumped
// home under the hand. One flag was carrying two facts: what has been SHOWN, and who has the lens.
describe('★ a hand on the lens is never followed by the town moving', () => {
  const HOLD = {
    by: 'hold' as const,
    castKey: '',
    followed: null,
    structureId: null,
    awake: true,
  }

  it('★ never throws the town home after a session that opened on a HOLD', () => {
    const { rig, cam } = fakeCamera()
    const framed = { current: false }
    const taken = { current: false }
    driveShot(rig, NO_WORLD, HOLD, framed, taken)
    // The viewer drags: the director stands down and the claim is released.
    taken.current = true
    cam.x = 500
    cam.y = 600
    cam.scale = 2
    driveShot(rig, NO_WORLD, RELEASED, framed, taken)
    expect(cam, 'the town was thrown home under the hand').toEqual({ x: 500, y: 600, scale: 2 })
  })

  it('still opens on the town for a viewer who has taken nothing', () => {
    const { rig, cam } = fakeCamera()
    driveShot(rig, NO_WORLD, HOLD, { current: false }, { current: false })
    driveShot(rig, NO_WORLD, RELEASED, { current: false }, { current: false })
    expect(cam).toEqual({ x: 0, y: 0, scale: OVERVIEW_ZOOM })
  })
})

// ★ The median dwell is 12 s and a held camera was dead still for every one of them.
describe('★ a held two-shot drifts, and never past one tile', () => {
  const CAST = { ada: { sx: 900, sy: 500 }, bo: { sx: 964, sy: 532 } }
  const WORLD = {
    getState: () => ({ agents: { ada: { x: 10, y: 10 }, bo: { x: 12, y: 12 } } }),
  } as unknown as Pick<WorldStore, 'getState'>
  const TWO = {
    by: 'cut' as const,
    castKey: 'ada bo',
    followed: null,
    structureId: null,
    awake: true,
  }
  const shotAt = (ms: number): Shot =>
    takeShot({ kind: 'twoShot', target: { at: 'cast', ids: ['ada', 'bo'] }, why: 'they talk' }, ms)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const heldFor = (ms: number): { x: number; y: number } => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rig, cam, tick } = fakeCamera(CAST)
    driveShot(rig, WORLD, TWO, { current: true }, { current: false }, shotAt(1000))
    now.mockReturnValue(1000 + ms)
    tick()
    return { x: cam.x - 932, y: cam.y - 516 }
  }

  it('★ has moved off the framed centre four seconds in', () => {
    const d = heldFor(4000)
    expect(Math.hypot(d.x, d.y), 'a twelve second two-shot is a frozen frame').toBeGreaterThan(13)
    expect(Math.hypot(d.x, d.y)).toBeLessThan(16)
    // Along the facing: `ada` faces `bo`, which is south-east on this screen.
    expect([Math.sign(d.x), Math.sign(d.y)]).toEqual([1, 1])
  })

  it('★ gives away no more than a tile, however long the shot holds', () => {
    for (const ms of [60_000, 600_000]) {
      const d = heldFor(ms)
      expect(Math.hypot(d.x, d.y), `${ms} ms`).toBeGreaterThan(30)
      expect(Math.hypot(d.x, d.y), `${ms} ms`).toBeLessThanOrEqual(33)
    }
  })

  it('stands still for a shot the director took no grammar for', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rig, cam, tick } = fakeCamera(CAST)
    driveShot(rig, WORLD, TWO, { current: true }, { current: false })
    tick()
    expect(cam).toEqual({ x: 932, y: 516, scale: 3 })
  })
})

// ★ `peakPushAt` eased a fifth of a stop over 2400 ms and was called by nothing. The stop ladder
// is rungs, so the push lands as the rung it eases toward: 4 minus the push, arriving at 4.
describe('★ the camera pushes in over a peak', () => {
  const FAR = { ada: { sx: 0, sy: 0 }, bo: { sx: 2000, sy: 1000 } }
  const PEAK = {
    by: 'cut' as const,
    castKey: 'ada bo',
    followed: null,
    structureId: null,
    awake: true,
  }
  const close = (ms: number): Shot =>
    takeShot({ kind: 'close', target: { at: 'cast', ids: ['ada', 'bo'] }, why: 'a peak' }, ms)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('★ opens one rung wide and arrives at 4 when the push has run', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { rig, cam, tick } = fakeCamera(FAR)
    driveShot(rig, NO_WORLD, PEAK, { current: true }, { current: false }, close(0))
    expect(cam.scale, 'a close that opened at the clamp has nowhere to push').toBe(3)
    now.mockReturnValue(PEAK_PUSH_MS - 1)
    tick()
    expect(cam.scale).toBe(3)
    now.mockReturnValue(PEAK_PUSH_MS)
    tick()
    expect(cam.scale).toBe(4)
  })
})
