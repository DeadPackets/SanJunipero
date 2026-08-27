import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { CITY_HEARTH_KIND, cityStructures, simTimeFromTick } from '@sj/shared'
import type { TileId, WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { tileToScreen, TILE_H } from './iso.js'
import { rectOnGround, type ScreenRect } from './ground.js'
import type { Scene } from './scene.js'
import type { WeatherLayer } from './weatherFx.js'
import type { BubbleLayer } from './bubbles.js'
import type { CharacterLayer } from './characters.js'
import { setEntityScaleMul } from './entities.js'
import { isGrave, toneReducer } from './tone.js'

const SMOKE_PUFFS = 3
const SMOKE_RISE_PX = 14
const SMOKE_LOOP_MS = 2400
const SMOKE_PUFF_R = 3 // a round puff, not an 8x8 card
export const SMOKE_MAX_ALPHA = 0.42
export const SMOKE_COLOR = 0xcfc6bc // warm grey, MASTER_PALETTE — cream read as white glass

// Smoke and a lit window both answer one question: does this kind have a hearth? The city
// template names the furnished kinds, and a fire pit is an open fire whether or not it is.
export const HEARTH_KINDS: ReadonlySet<string> = new Set([
  ...cityStructures()
    .filter((c) => c.furnishings.some((f) => f.kind === CITY_HEARTH_KIND))
    .map((c) => c.kind),
  'fire_pit',
])
export const SHIMMER_MAX = 60
const SHIMMER_HZ = 0.5
export const TREES_MAX = 80
const TREE_SKEW = 0.06
const GLOW_R = 4 // a round pool of light, not a 6x6 card
const GLOW_COLOR = 0xf4e289
// additive blending drives a honey square to near-white; this is the ceiling that keeps it
// reading as lamplight rather than as a pale rectangle stuck to the wall
export const GLOW_BASE_ALPHA = 0.3
export const GLOW_SWING = 0.12
const GLOW_HZ = 0.4
const BOUNCE_MS = 260
const BOUNCE_SCALE = 1.18
const SQUASH_Y = 0.92
const SQUASH_HZ = 0.3
const SQUASH_VERBS = ['build', 'till', 'harvest', 'fish'] as const
const BIRD_MIN_S = 20
const BIRD_MAX_S = 45
export const FIRE_COLOR = 0xf7a66b
const FIRE_HZ = 7
const FIRE_FROZEN_ALPHA = 0.6

const WATER: TileId = 2
const FOREST: TileId = 3

/** The two ground decorations at painted size: a canopy anchors bottom-centre on its tile's centre, a shimmer top-left one pixel to the left of it. */
export const CANOPY_PX = { w: 12, h: 20 } as const
export const SHIMMER_PX = { w: 2, h: 2 } as const

// Painted in code, not commissioned: scenery is not a structure kind, so it sits outside the
// codex the art coverage gate measures.
const CANOPY_TRUNK = 0x7e512b
const CANOPY_BODY = 0x6f9455
const CANOPY_LIT = 0x93b573 // lit from the upper left, like everything else
const CANOPY_SHADE = 0x4f7040

/** Half-width of the canopy per row, top to bottom: a round crown over a two-pixel trunk. */
const CANOPY_ROWS: readonly number[] = [2, 3, 4, 5, 5, 6, 6, 6, 5, 5, 4, 3, 2]

/** The tree, as flat blocks with hard edges — one row of the crown at a time. */
function canopyBlocks(): {
  x: number
  y: number
  w: number
  h: number
  color: number
}[] {
  const out: { x: number; y: number; w: number; h: number; color: number }[] = []
  const mid = CANOPY_PX.w / 2
  for (const [y, half] of CANOPY_ROWS.entries()) {
    out.push({ x: mid - half, y, w: half * 2, h: 1, color: CANOPY_BODY })
    if (y >= 1 && y <= 6)
      out.push({ x: mid - half, y, w: Math.min(3, half), h: 1, color: CANOPY_LIT })
    if (y >= 7)
      out.push({
        x: mid + half - Math.min(3, half),
        y,
        w: Math.min(3, half),
        h: 1,
        color: CANOPY_SHADE,
      })
  }
  out.push({
    x: mid - 1,
    y: CANOPY_ROWS.length,
    w: 2,
    h: CANOPY_PX.h - CANOPY_ROWS.length,
    color: CANOPY_TRUNK,
  })
  return out
}

export type Decoration = { kind: 'tree' | 'shimmer'; x: number; y: number; sx: number; sy: number }

/** The screen rectangle a decoration paints — the same numbers `sampleTerrain` gives Pixi. */
export function decorationQuad(d: Decoration): ScreenRect {
  const size = d.kind === 'tree' ? CANOPY_PX : SHIMMER_PX
  return d.kind === 'tree'
    ? { x0: d.sx - size.w / 2, y0: d.sy - size.h, x1: d.sx + size.w / 2, y1: d.sy }
    : { x0: d.sx, y0: d.sy, x1: d.sx + size.w, y1: d.sy + size.h }
}

/** Places the decorations, refusing any quad that leaves the painted ground — a 20 px canopy on a tile centre reaches 12 px past the top vertex, so an edge tile hangs over the void. */
export function sampleDecorations(terrain: TileId[][]): Decoration[] {
  const out: Decoration[] = []
  const place = (kind: Decoration['kind'], x: number, y: number): boolean => {
    const { sx, sy } = tileToScreen(x, y)
    const d: Decoration = { kind, x, y, sx, sy: sy + TILE_H / 2 }
    if (kind === 'shimmer') d.sx = sx - 1
    if (!rectOnGround(terrain, decorationQuad(d))) return false
    out.push(d)
    return true
  }
  let trees = 0,
    shimmers = 0
  for (let y = 0; y < terrain.length && shimmers < SHIMMER_MAX; y++)
    for (let x = 0; x < terrain[y]!.length && shimmers < SHIMMER_MAX; x++)
      if (terrain[y]![x] === WATER && place('shimmer', x, y)) shimmers++
  for (let y = 0; y < terrain.length && trees < TREES_MAX; y++)
    for (let x = 0; x < terrain[y]!.length && trees < TREES_MAX; x++)
      if (terrain[y]![x] === FOREST && place('tree', x, y)) trees++
  return out
}

export type AmbientDirector = {
  tick(dtMs: number): void
  setTone(grave: boolean): void
  destroy(): void
}

export function createAmbient(
  scene: Scene,
  store: WorldStore,
  layers: { weather: WeatherLayer; bubbles: BubbleLayer; chars?: CharacterLayer },
): AmbientDirector {
  // shimmer and canopies are ground decoration: under every body, over the baked field
  const under = new Container()
  under.eventMode = 'none' // decorative layers must never swallow stage hit-tests
  scene.layers.groundDecal.addChild(under)

  const px = (w: number, h: number, color: number): Texture => {
    const g = new Graphics()
    g.rect(0, 0, w, h)
    g.fill(color)
    const t = scene.app.renderer.generateTexture(g)
    g.destroy()
    return t
  }
  const puffG = new Graphics()
  puffG.circle(SMOKE_PUFF_R, SMOKE_PUFF_R, SMOKE_PUFF_R)
  puffG.fill(SMOKE_COLOR)
  const puffTex = scene.app.renderer.generateTexture(puffG)
  puffG.destroy()
  const shimmerTex = px(SHIMMER_PX.w, SHIMMER_PX.h, 0xffffff)
  const glowG = new Graphics()
  glowG.circle(GLOW_R, GLOW_R, GLOW_R)
  glowG.fill(GLOW_COLOR)
  const glowTex = scene.app.renderer.generateTexture(glowG)
  glowG.destroy()
  const birdTex = px(3, 2, 0x241f2b)
  const canopyG = new Graphics()
  for (const b of canopyBlocks()) {
    canopyG.rect(b.x, b.y, b.w, b.h)
    canopyG.fill(b.color)
  }
  const canopyTex = scene.app.renderer.generateTexture(canopyG)
  canopyG.destroy()
  const fireTex = px(10, 12, FIRE_COLOR)

  let t = 0 // director clock — freezes under grave tone, so every animator stills mid-frame
  let grave = false
  let tone = { graveUntil: 0 }

  const offEvents = store.onEvents((evts) => {
    tone = toneReducer(tone, evts, store.getTick())
    for (const ev of evts) {
      if (ev.type === 'structure_completed' || ev.type === 'item_spawned') {
        const p = ev.payload as { id: string }
        bounces.push({
          kind: ev.type === 'structure_completed' ? 'structure' : 'item',
          id: p.id,
          at: t,
        })
      }
    }
  })

  // ── per-structure effect sprites ──
  const smoke = new Map<string, Sprite[]>()
  const glows = new Map<string, Sprite>()
  const fires = new Map<string, Sprite>()
  /** where a structure's effects hang and whether it is alight — rewritten when the world
   *  changes, so the frame loop below reads it instead of walking every structure again */
  const anchors = new Map<string, { sx: number; sy: number; hasFire: boolean }>()
  const bounces: { kind: 'structure' | 'item'; id: string; at: number }[] = []
  let fxState: WorldState | null = null

  /** Create, place and destroy the effect sprites. Deltas arrive at most every 250 ms, so this
   *  runs on a new world state rather than on every frame. */
  const syncStructureFx = (state: WorldState): void => {
    const live = new Set<string>()
    for (const s of Object.values(state.structures)) {
      live.add(s.id)
      const anchor = tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
      const hasFire = s.stage === 'complete' && HEARTH_KINDS.has(s.kind)
      anchors.set(s.id, { sx: anchor.sx, sy: anchor.sy, hasFire })
      if (hasFire && !smoke.has(s.id)) {
        const puffs: Sprite[] = []
        for (let i = 0; i < SMOKE_PUFFS; i++) {
          const p = new Sprite(puffTex)
          p.anchor.set(0.5, 0.5)
          p.eventMode = 'none'
          scene.layers.overhead.addChild(p)
          puffs.push(p)
        }
        smoke.set(s.id, puffs)
      }
      if (hasFire && !glows.has(s.id)) {
        const g = new Sprite(glowTex)
        g.anchor.set(0.5, 1)
        g.blendMode = 'add'
        g.eventMode = 'none'
        scene.layers.overhead.addChild(g)
        glows.set(s.id, g)
      }
      // the door face — "deep blue night, warm window glow"
      glows.get(s.id)?.position.set(anchor.sx, anchor.sy - 2)
      if (s.burning && !fires.has(s.id)) {
        const f = new Sprite(fireTex)
        f.anchor.set(0.5, 1)
        f.blendMode = 'add'
        f.eventMode = 'none'
        scene.layers.overhead.addChild(f)
        fires.set(s.id, f)
      }
      const fire = fires.get(s.id)
      if (fire !== undefined) {
        if (s.burning) fire.position.set(anchor.sx, anchor.sy - 8)
        else {
          fire.destroy()
          fires.delete(s.id)
        }
      }
    }
    for (const map of [smoke, glows, fires] as const) {
      for (const [id, v] of map) {
        if (live.has(id)) continue
        if (Array.isArray(v)) for (const p of v) p.destroy()
        else v.destroy()
        map.delete(id)
      }
    }
    for (const id of anchors.keys()) if (!live.has(id)) anchors.delete(id)
  }

  // ── sampled terrain sprites ──
  let sampledTerrain: TileId[][] | null = null
  const shimmers: { sprite: Sprite; phase: number }[] = []
  const trees: { sprite: Sprite; phase: number }[] = []

  const sampleTerrain = (terrain: TileId[][]): void => {
    for (const s of shimmers) s.sprite.destroy()
    for (const s of trees) s.sprite.destroy()
    shimmers.length = 0
    trees.length = 0
    // `sampleDecorations` is the whole placement decision, caps and ground law included, so
    // there is nothing here for a test to be unable to see.
    for (const d of sampleDecorations(terrain)) {
      const sprite = new Sprite(d.kind === 'tree' ? canopyTex : shimmerTex)
      if (d.kind === 'tree') sprite.anchor.set(0.5, 1)
      sprite.position.set(d.sx, d.sy)
      under.addChild(sprite)
      const phase = ((d.x * 7 + d.y * 13) % 628) / 100 // deterministic phase, no RNG
      ;(d.kind === 'tree' ? trees : shimmers).push({ sprite, phase })
    }
  }

  // ── birds: a 3-sprite V gliding the sky band (viewer-side random — presentation only) ──
  const birdV = new Container()
  for (const [bx, by] of [
    [0, 0],
    [-6, 4],
    [6, 4],
  ] as const) {
    const b = new Sprite(birdTex)
    b.position.set(bx, by)
    birdV.addChild(b)
  }
  birdV.visible = false
  birdV.eventMode = 'none'
  scene.app.stage.addChild(birdV)
  let birdAt = -1 // director-time when the current flight started; <0 → waiting
  let nextBirdIn = (BIRD_MIN_S + Math.random() * (BIRD_MAX_S - BIRD_MIN_S)) * 1000
  const BIRD_FLIGHT_MS = 10_000

  const applyTone = (v: boolean): void => {
    grave = v
    layers.weather.setSuppressed(v)
    layers.bubbles.setSuppressed(v)
    layers.chars?.setEmotesHidden(v)
    if (v) for (const f of fires.values()) f.alpha = FIRE_FROZEN_ALPHA // fire stays visible, only its animation stills
  }

  const tick = (dtMs: number): void => {
    const state = store.getState()
    if (state === null) return
    const nowGrave = isGrave(tone, store.getTick())
    if (nowGrave !== grave) applyTone(nowGrave)
    if (!grave) t += dtMs

    if (state.terrain !== sampledTerrain) {
      sampledTerrain = state.terrain
      sampleTerrain(state.terrain)
    }
    if (state !== fxState) {
      fxState = state
      syncStructureFx(state)
    }

    const night = simTimeFromTick(store.getTick()).isNight

    // structures: smoke (complete), night glow (complete), fire (burning). Only the sprites
    // this director created are walked — the world itself is walked when it changes.
    for (const [id, puffs] of smoke) {
      const a = anchors.get(id)
      if (a === undefined) continue
      puffs.forEach((p, i) => {
        const prog = (t / SMOKE_LOOP_MS + i / SMOKE_PUFFS) % 1
        p.position.set(a.sx + 8, a.sy - 34 - prog * SMOKE_RISE_PX)
        p.alpha = SMOKE_MAX_ALPHA * (1 - prog)
        p.visible = a.hasFire
      })
    }
    const glowAlpha =
      GLOW_BASE_ALPHA + GLOW_SWING * (0.5 + 0.5 * Math.sin(2 * Math.PI * GLOW_HZ * (t / 1000)))
    for (const [id, glow] of glows) {
      glow.visible = (anchors.get(id)?.hasFire ?? false) && night
      glow.alpha = glowAlpha
    }
    if (!grave) {
      const fireAlpha = 0.4 + 0.4 * (0.5 + 0.5 * Math.sin(2 * Math.PI * FIRE_HZ * (t / 1000)))
      for (const f of fires.values()) f.alpha = fireAlpha
    }

    // water shimmer + swaying trees
    for (const sh of shimmers)
      sh.sprite.alpha =
        0.15 + 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * SHIMMER_HZ * (t / 1000) + sh.phase))
    for (const tr of trees) tr.sprite.skew.x = TREE_SKEW * Math.sin(t / 1000 + tr.phase)

    // placement bounce: 1.0 → 1.18 → 1.0 over 260ms
    for (let i = bounces.length - 1; i >= 0; i--) {
      const b = bounces[i]!
      const p = (t - b.at) / BOUNCE_MS
      const done = p >= 1 || p < 0
      const k = done ? 1 : 1 + (BOUNCE_SCALE - 1) * Math.sin(Math.PI * p)
      if (!setEntityScaleMul(scene, b.kind, b.id, k) || done) bounces.splice(i, 1)
    }

    // squash-and-stretch while a work verb persists
    const chars = layers.chars
    if (chars !== undefined) {
      for (const a of Object.values(state.agents)) {
        const working =
          a.alive &&
          a.activity !== null &&
          (SQUASH_VERBS as readonly string[]).includes(a.activity.verb)
        if (working && grave) continue // a grave town stills mid-squash rather than springing back
        chars.setScaleMulY(
          a.id,
          working
            ? 1 - (1 - SQUASH_Y) * (0.5 + 0.5 * Math.sin(2 * Math.PI * SQUASH_HZ * (t / 1000)))
            : 1,
        )
      }
    }

    // birds across the sky band
    if (!grave) {
      if (birdAt < 0) {
        nextBirdIn -= dtMs
        if (nextBirdIn <= 0) {
          birdAt = t
          birdV.visible = true
          birdV.position.set(-20, 30 + Math.random() * 60)
        }
      }
      if (birdAt >= 0) {
        const p = (t - birdAt) / BIRD_FLIGHT_MS
        if (p >= 1) {
          birdAt = -1
          birdV.visible = false
          nextBirdIn = (BIRD_MIN_S + Math.random() * (BIRD_MAX_S - BIRD_MIN_S)) * 1000
        } else {
          birdV.position.x = -20 + p * (scene.app.screen.width + 40)
        }
      }
    }
  }

  return {
    tick,
    setTone: applyTone,
    destroy: () => {
      offEvents()
      for (const puffs of smoke.values()) for (const p of puffs) p.destroy()
      for (const g of glows.values()) g.destroy()
      for (const f of fires.values()) f.destroy()
      for (const s of shimmers) s.sprite.destroy()
      for (const tr of trees) tr.sprite.destroy()
      birdV.destroy({ children: true })
      under.destroy({ children: true })
      for (const tex of [puffTex, shimmerTex, glowTex, birdTex, canopyTex, fireTex])
        tex.destroy(true)
    },
  }
}
