import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { CITY_HEARTH_KIND, cityStructures } from '@sj/shared'
import type { TileId, WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { tileToScreen, TILE_H } from './iso.js'
import { rectOnGround, type ScreenRect } from './ground.js'
import type { Scene } from './scene.js'
import type { WeatherLayer } from './weatherFx.js'
import type { BubbleLayer } from './bubbles.js'
import type { CharacterLayer } from './characters.js'
import { setEntityScaleMul } from './entities.js'
import { phaseOf } from './charAnim.js'
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
/** A canopy sways by a whole pixel of its crown, never by a shear: a sheared 12×20 NEAREST
 *  sprite resamples at fractional texels every frame and its edge crawls (D14). */
const SWAY_HZ = 0.16
const BOUNCE_MS = 260
const BOUNCE_SCALE = 1.18
const SQUASH_Y = 0.92
const SQUASH_HZ = 0.3
const SQUASH_VERBS = ['build', 'till', 'harvest', 'fish'] as const
const BIRD_MIN_S = 20
const BIRD_MAX_S = 45

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

/** The tree, as flat blocks with hard edges — one row of the crown at a time. The trunk is
 *  the last block, so the crown can be drawn on its own and swayed over a still trunk. */
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
  // Chosen by hash, not by scan order: a scan that stops at the cap woods the north-west rows
  // and leaves the southern forest bare (D15). The hash spreads the cap over the whole map.
  const spread = (kind: Decoration['kind'], id: TileId, cap: number): void => {
    const found: { x: number; y: number; h: number }[] = []
    for (let y = 0; y < terrain.length; y++)
      for (let x = 0; x < terrain[y]!.length; x++)
        if (terrain[y]![x] === id)
          found.push({ x, y, h: (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0 })
    found.sort((a, b) => a.h - b.h || a.y - b.y || a.x - b.x)
    let placed = 0
    for (const f of found) {
      if (placed >= cap) break
      if (place(kind, f.x, f.y)) placed++
    }
  }
  spread('shimmer', WATER, SHIMMER_MAX)
  spread('tree', FOREST, TREES_MAX)
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
  const birdTex = px(3, 2, 0x241f2b)
  const blocks = canopyBlocks()
  const trunk = blocks.at(-1)!
  const crownG = new Graphics()
  for (const b of blocks.slice(0, -1)) {
    crownG.rect(b.x, b.y, b.w, b.h)
    crownG.fill(b.color)
  }
  const crownTex = scene.app.renderer.generateTexture(crownG)
  crownG.destroy()
  const trunkTex = px(trunk.w, trunk.h, trunk.color)

  // Under `prefers-reduced-motion` the director clock never advances: every oscillator holds
  // at its base, and a bounce or a squash arrives at rest instead of travelling.
  const still = !scene.wantsMotion()
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

  // ── per-structure effect sprites (the lights live in lightPools, above the night grade) ──
  const smoke = new Map<string, Sprite[]>()
  /** where a structure's effects hang and whether it is alight — rewritten when the world
   *  changes, so the frame loop below reads it instead of walking every structure again */
  const anchors = new Map<string, { sx: number; sy: number; hasFire: boolean }>()
  const bounces: { kind: 'structure' | 'item'; id: string; at: number }[] = []
  let fxState: WorldState | null = null
  const working: string[] = [] // the bodies a work verb is squashing, refreshed with the world

  /** Create, place and destroy the effect sprites. Deltas arrive at most every 250 ms, so this
   *  runs on a new world state rather than on every frame. */
  const syncStructureFx = (state: WorldState): void => {
    working.length = 0
    for (const a of Object.values(state.agents)) {
      if (
        a.alive &&
        a.activity !== null &&
        (SQUASH_VERBS as readonly string[]).includes(a.activity.verb)
      )
        working.push(a.id)
      else layers.chars?.setScaleMulY(a.id, 1)
    }
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
    }
    for (const [id, puffs] of smoke) {
      if (live.has(id)) continue
      for (const p of puffs) p.destroy()
      smoke.delete(id)
    }
    for (const id of anchors.keys()) if (!live.has(id)) anchors.delete(id)
  }

  // ── sampled terrain sprites ──
  let sampledTerrain: TileId[][] | null = null
  const shimmers: { sprite: Sprite; phase: number }[] = []
  const trees: { crown: Sprite; trunk: Sprite; phase: number }[] = []

  const sampleTerrain = (terrain: TileId[][]): void => {
    for (const s of shimmers) s.sprite.destroy()
    for (const tr of trees) {
      tr.crown.destroy()
      tr.trunk.destroy()
    }
    shimmers.length = 0
    trees.length = 0
    // `sampleDecorations` is the whole placement decision, caps and ground law included, so
    // there is nothing here for a test to be unable to see.
    for (const d of sampleDecorations(terrain)) {
      const phase = phaseOf(`${d.x},${d.y}`) // deterministic, no RNG
      if (d.kind === 'shimmer') {
        const sprite = new Sprite(shimmerTex)
        sprite.position.set(d.sx, d.sy)
        under.addChild(sprite)
        shimmers.push({ sprite, phase })
        continue
      }
      const trunkS = new Sprite(trunkTex)
      trunkS.anchor.set(0.5, 1)
      trunkS.position.set(d.sx, d.sy)
      const crown = new Sprite(crownTex)
      crown.anchor.set(0.5, 1)
      crown.position.set(d.sx, d.sy - trunk.h)
      under.addChild(trunkS, crown)
      trees.push({ crown, trunk: trunkS, phase })
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
  // In the world, over the town: a flock on `app.stage` neither parallaxed nor darkened (D24).
  scene.layers.overhead.addChild(birdV)
  let birdAt = -1 // director-time when the current flight started; <0 → waiting
  let nextBirdIn = (BIRD_MIN_S + Math.random() * (BIRD_MAX_S - BIRD_MIN_S)) * 1000
  const BIRD_FLIGHT_MS = 10_000

  const applyTone = (v: boolean): void => {
    grave = v
    layers.weather.setSuppressed(v)
    layers.bubbles.setSuppressed(v)
    layers.chars?.setEmotesHidden(v)
  }

  const tick = (dtMs: number): void => {
    const state = store.getState()
    if (state === null) return
    const nowGrave = isGrave(tone, store.getTick())
    if (nowGrave !== grave) applyTone(nowGrave)
    if (!grave && !still) t += dtMs

    if (state.terrain !== sampledTerrain) {
      sampledTerrain = state.terrain
      sampleTerrain(state.terrain)
    }
    if (state !== fxState) {
      fxState = state
      syncStructureFx(state)
    }

    // structures: smoke (complete)
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

    // water shimmer + swaying trees
    for (const sh of shimmers)
      sh.sprite.alpha =
        0.15 + 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * SHIMMER_HZ * (t / 1000) + sh.phase))
    for (const tr of trees)
      tr.crown.position.x =
        tr.trunk.x + Math.round(Math.sin(2 * Math.PI * SWAY_HZ * (t / 1000) + tr.phase))

    // placement bounce: 1.0 → 1.18 → 1.0 over 260ms
    for (let i = bounces.length - 1; i >= 0; i--) {
      const b = bounces[i]!
      const p = (t - b.at) / BOUNCE_MS
      const done = still || p >= 1 || p < 0
      const k = done ? 1 : 1 + (BOUNCE_SCALE - 1) * Math.sin(Math.PI * p)
      const subject = setEntityScaleMul(scene, b.kind, b.id, k)
      if (done || !subject) bounces.splice(i, 1)
    }

    // squash-and-stretch while a work verb persists — a grave town stills mid-squash
    if (!grave && !still && layers.chars !== undefined) {
      const k = 1 - (1 - SQUASH_Y) * (0.5 + 0.5 * Math.sin(2 * Math.PI * SQUASH_HZ * (t / 1000)))
      for (const id of working) layers.chars.setScaleMulY(id, k)
    }

    // birds across the town, in world px, so they scale and darken with everything else
    if (!grave && !still) {
      const box = scene.reachableBox()
      if (birdAt < 0) {
        nextBirdIn -= dtMs
        if (nextBirdIn <= 0) {
          birdAt = t
          birdV.visible = true
          birdV.position.set(box.minX - 20, box.minY + 30 + Math.random() * 60)
        }
      }
      if (birdAt >= 0) {
        const p = (t - birdAt) / BIRD_FLIGHT_MS
        if (p >= 1) {
          birdAt = -1
          birdV.visible = false
          nextBirdIn = (BIRD_MIN_S + Math.random() * (BIRD_MAX_S - BIRD_MIN_S)) * 1000
        } else {
          birdV.position.x = box.minX - 20 + p * (box.maxX - box.minX + 40)
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
      for (const s of shimmers) s.sprite.destroy()
      for (const tr of trees) {
        tr.crown.destroy()
        tr.trunk.destroy()
      }
      birdV.destroy({ children: true })
      under.destroy({ children: true })
      for (const tex of [puffTex, shimmerTex, birdTex, crownTex, trunkTex]) tex.destroy(true)
    },
  }
}
