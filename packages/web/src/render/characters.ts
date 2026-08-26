import { Container, Graphics, Polygon, Rectangle, Sprite, Texture } from 'pixi.js'
import type { SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { WORLD_TEXT_LINE_H, WORLD_TEXT_PX } from '../textFloor.js'
import { bodyDepthBox } from './depth.js'
import { facingFrom, tileToScreen, type Facing } from './iso.js'
import type { DepthEntry } from './layers.js'
import type { Scene } from './scene.js'
import { HIT_MIN_PX, SHOULDER_W, bodyHitPolygon, inflateToMin } from './hitShapes.js'
import { TAG_PAD_X, TAG_PAD_Y, anchorForSprite, placeTag } from './tooltip.js'
import { characterArt, type TextureBook } from './textures.js'
import { createWorldLabel, type WorldLabel } from './worldLabel.js'
import { faceFor, worldTextScale } from './textFaces.js'
import {
  CROWD_PITCH_PX,
  CROWD_SETTLE_MS,
  NO_OFFSET,
  crowdOffsets,
  type CrowdOffset,
} from './crowd.js'
import {
  CELL,
  CHAR_TARGET_PX,
  EMOTE_KINDS,
  FEET_Y,
  NAME_TAG_ABOVE_HEAD_PX,
  SHEET_COLS,
  SHEET_ROWS,
  WALK_LEAD_TICKS,
  cellRowLadder,
  charPose,
  emoteFor,
  gaitOf,
  initialTickClock,
  interpolatePos,
  legFacing,
  nameTagText,
  observeTick,
  prunePath,
  scheduleLeg,
  strideFrameMs,
  ticksPerTileOf,
  type Gait,
  type TickClock,
  type Waypoint,
} from './charAnim.js'

export const EMOTE_MS = 2000
export const EMOTE_ABOVE_HEAD_PX = 12
// The name tag is set at the face's own size, which is above the 12px floor, not at it.
export const CHAR_TAG_FONT_PX = faceFor('name').size
export const CHAR_TAG_LINE_H = Math.max(WORLD_TEXT_LINE_H, CHAR_TAG_FONT_PX + 2)
export const SHADOW_ALPHA = 0.25
export const EMOTE_PX = 16

/** The movement law's defaults, restated for a world whose snapshot has not arrived; `charAnim.test.ts` asserts these are what `shared/src/config.ts` defaults to. */
export const MOVEMENT_FALLBACK = { debuffThreshold: 30, base: 1, debuff: 2 } as const

type CharArt = ReturnType<typeof characterArt>
type Sheet = { art: CharArt; texture: Texture | null }

type CharEntry = {
  sprite: Sprite
  shadow: Sprite
  emote: Sprite
  nameTag: Container
  nameTagBg: Graphics
  nameTagLabel: WorldLabel
  hit: Polygon
  /** the sheet's own figure height, so the capsule follows the art rather than a second table */
  figureH: number
  hitScale: number
  /** standing in a rank, so the 24 px floor may not grow this capsule past one pitch */
  ranked: boolean
  emoteUntil: number
  facing: Facing
  path: Waypoint[]
  /** this body's own phase and stride, derived once from its id and never again */
  gait: Gait
  /** what the record says the leg in flight costs, so the legs can match the ground */
  legMs: number
  /** the tile the body is standing on RIGHT NOW — interpolated, never rounded (F-3c), held in
   *  the one entry this body publishes every frame rather than rebuilt into a fresh pair */
  depth: DepthEntry
  /** where in its tile's rank this body is standing, and where it is sliding to. A world
   *  offset, so the box, the cull, the shadow and every label follow it for free. */
  crowd: CrowdOffset
  crowdFrom: CrowdOffset
  crowdTo: CrowdOffset
  crowdSinceMs: number
}

export type CharacterLayer = {
  tick(nowMs: number): void
  setEmotesHidden(v: boolean): void
  getSprite(agentId: string): Sprite | null
  destroy(): void
}

// per-source cell cache: v2 placeholder lattice slices AND v4 manifest rect slices
const sliceCache = new WeakMap<Texture, Map<string, Texture>>()
function cached(sheet: Texture, key: string, make: () => Texture): Texture {
  let m = sliceCache.get(sheet)
  if (m === undefined) {
    m = new Map()
    sliceCache.set(sheet, m)
  }
  let t = m.get(key)
  if (t === undefined) {
    t = make()
    m.set(key, t)
  }
  return t
}

// v2 fallback (placeholder sheets, pre-v4 codex sheets): fixed 96px lattice
function sliceV2(sheet: Texture, row: (typeof SHEET_ROWS)[number], facing: Facing): Texture {
  return cached(sheet, `${row}:${facing}`, () => {
    const col = SHEET_COLS.indexOf(facing)
    const rowIdx = SHEET_ROWS.indexOf(row)
    return new Texture({
      source: sheet.source,
      frame: new Rectangle(col * CELL, rowIdx * CELL, CELL, CELL),
    })
  })
}

// v4 hi-res atlas: manifest rects are the only slicing truth (no lattice)
function sliceV4(
  atlas: Texture,
  art: CharArt,
  row: (typeof SHEET_ROWS)[number],
  facing: Facing,
): Texture | null {
  const cell = art.manifest?.cells[`${row}-${facing}`]
  if (cell === undefined) return null
  return cached(
    atlas,
    `${row}-${facing}`,
    () =>
      new Texture({ source: atlas.source, frame: new Rectangle(cell.x, cell.y, cell.w, cell.h) }),
  )
}

// Who belongs on the TOWN map. The dead leave it, and so does anyone who has gone indoors — an
// occupant carries an `insideId` and the interior sub-scene draws them there instead.
export function rendersOnMap(a: { alive: boolean; insideId?: string }): boolean {
  return a.alive && a.insideId === undefined
}

export type CharacterCell = {
  texture: Texture
  anchor: { x: number; y: number }
  scale: number
  /** the sheet's own figure height, so a caller sizing anything off the art has one source */
  figureH: number
}

// One posed cell out of a loaded sheet, feet-anchored and scaled to the world footprint. The map
// layer and the interior sub-scene share it so they cannot disagree about feet or facing.
export function characterCell(
  sheet: Texture,
  art: CharArt,
  row: (typeof SHEET_ROWS)[number],
  facing: Facing,
): CharacterCell | null {
  if (art.manifest === null) {
    return {
      texture: sliceV2(sheet, row, facing),
      anchor: { x: 0.5, y: FEET_Y / CELL },
      scale: CHAR_TARGET_PX / 64,
      figureH: 64,
    }
  }
  // A missing cell degrades inside its own facing — never across one, and never by leaving the
  // last texture where it was.
  for (const r of cellRowLadder(row)) {
    const cell = art.manifest.cells[`${r}-${facing}`]
    const texture = sliceV4(sheet, art, r, facing)
    if (cell === undefined || texture === null) continue
    return {
      texture,
      anchor: { x: cell.feetX / cell.w, y: cell.feetY / cell.h },
      scale: CHAR_TARGET_PX / art.manifest.figureH,
      figureH: art.manifest.figureH,
    }
  }
  return null
}

export function createCharacterLayer(
  scene: Scene,
  book: TextureBook,
  store: WorldStore,
  onSelect: (agentId: string) => void,
): CharacterLayer {
  const entries = new Map<string, CharEntry>()
  const sheets = new Map<string, Sheet>() // agentId → resolved art + loaded texture
  let lastAssetsSeq = store.assetsSeq()
  let emoteAtlas: Texture | null = null
  let emotesHidden = false
  /** ONE clock for the whole town: the world ticks for everybody at once, so a per-body
   *  estimate would be five noisy copies of one number. */
  let clock: TickClock = initialTickClock()
  void book.get('/assets/emotes.png').then((t) => {
    emoteAtlas = t
  })

  const loadSheet = (agentId: string, swapFrom: string | null): void => {
    const art = characterArt(store.assetRecords(), agentId)
    const sheet: Sheet = { art, texture: null }
    sheets.set(agentId, sheet)
    const p =
      swapFrom !== null && swapFrom !== art.url ? book.swap(swapFrom, art.url) : book.get(art.url)
    void p.then((t) => {
      if (sheets.get(agentId) !== sheet) return // superseded by a newer resolve
      sheet.texture = t
    })
  }

  // Publish where every body is standing. The frame's one owner sorts these against the
  // structures; a body no longer carries an opinion about who is in front of whom.
  const published: DepthEntry[] = []
  scene.addDepthSource(() => {
    published.length = 0
    for (const e of entries.values()) published.push(e.depth)
    return published
  })

  // shared 20×8 blob shadow — Graphics-generated once
  const shadowG = new Graphics()
  shadowG.ellipse(10, 4, 10, 4)
  shadowG.fill(0x000000)
  const shadowTexture = scene.app.renderer.generateTexture(shadowG)
  shadowG.destroy()

  // One Polygon per entry, rewritten in place when the applied sprite scale moves. HIT_MIN_PX is
  // a Fitts's-law floor for a target in open space, so a `ranked` body caps its WIDTH at the rank
  // pitch — hitting the wrong person is worse than a small target — and keeps the whole height.
  let hitZoom = 1
  const setHitScale = (e: CharEntry, scale: number, figureH: number, ranked = e.ranked): void => {
    if (e.hitScale === scale && e.figureH === figureH && e.ranked === ranked) return
    e.hitScale = scale
    e.figureH = figureH
    e.ranked = ranked
    e.hit.points = inflateToMin(
      bodyHitPolygon(figureH, scale),
      HIT_MIN_PX,
      scale * hitZoom,
      ranked ? CROWD_PITCH_PX * hitZoom : Infinity,
    )
  }
  // The inflation floor is a SCREEN size, so a zoom change re-cuts every capsule. Cheap: it
  // fires on a camera stop, not on a frame.
  const recutOnZoom = (): void => {
    const zoom = scene.getZoom?.() ?? 1
    if (zoom === hitZoom) return
    hitZoom = zoom
    for (const e of entries.values()) {
      const scale = e.hitScale,
        figureH = e.figureH
      e.hitScale = 0
      setHitScale(e, scale, figureH)
    }
  }

  const ensure = (agentId: string, x: number, y: number): CharEntry => {
    let e = entries.get(agentId)
    if (e !== undefined) return e
    const sprite = new Sprite()
    sprite.anchor.set(0.5, FEET_Y / CELL)
    sprite.scale.set(CHAR_TARGET_PX / 64)
    sprite.eventMode = 'static'
    sprite.cursor = 'pointer'
    const hit = new Polygon(bodyHitPolygon(64, CHAR_TARGET_PX / 64))
    sprite.hitArea = hit
    sprite.on('pointertap', () => onSelect(agentId))
    const shadow = new Sprite(shadowTexture)
    shadow.anchor.set(0.5, 0.5)
    shadow.alpha = SHADOW_ALPHA
    shadow.eventMode = 'none'
    const emote = new Sprite()
    emote.anchor.set(0.5, 1)
    emote.visible = false
    emote.eventMode = 'none'
    const nameTag = new Container()
    nameTag.visible = false
    nameTag.eventMode = 'none'
    const nameTagBg = new Graphics()
    const nameTagLabel = createWorldLabel('', {
      fontFamily: faceFor('name').family,
      fontSize: CHAR_TAG_FONT_PX,
      fill: 0x43394a,
      lineHeight: CHAR_TAG_LINE_H,
    })
    nameTagLabel.anchor.set(0.5, 1) // match the bg slab, which is drawn centered above the origin
    nameTag.addChild(nameTagBg, nameTagLabel)
    sprite.on('pointerover', () => {
      nameTag.visible = true
    })
    sprite.on('pointerout', () => {
      nameTag.visible = false
    })
    // each companion to the layer it belongs in: a contact shadow under every body, the
    // emote and the tag over every body. None of them competes with the depth sort any more.
    scene.layers.shadow.addChild(shadow)
    scene.layers.entities.addChild(sprite)
    scene.layers.worldText.addChild(emote, nameTag)
    const now = performance.now()
    e = {
      sprite,
      shadow,
      emote,
      nameTag,
      nameTagBg,
      nameTagLabel,
      hit,
      figureH: 0,
      hitScale: 0,
      ranked: false,
      emoteUntil: 0,
      facing: 'sw',
      gait: gaitOf(agentId),
      legMs: clock.periodMs,
      path: [{ x, y, atMs: now }],
      depth: { box: bodyDepthBox(agentId, x, y), node: sprite },
      crowd: NO_OFFSET,
      crowdFrom: NO_OFFSET,
      crowdTo: NO_OFFSET,
      crowdSinceMs: now,
    }
    setHitScale(e, CHAR_TARGET_PX / 64, 64)
    entries.set(agentId, e)
    loadSheet(agentId, null)
    return e
  }

  const offEvents = store.onEvents((evts: SimEvent[]) => {
    const state = store.getState()
    if (state === null) return
    const now = performance.now()
    // One `onEvents` call is one delta message, so the ticks inside it are what the world
    // advanced by — a catch-up burst is not mistaken for the world running fast.
    const ticks = new Set(evts.map((ev) => ev.tick)).size
    clock = observeTick(clock, now, Math.max(1, ticks))
    const conf = store.getConfig()
    const cfg = {
      debuffThreshold: conf?.needs.debuffThreshold ?? MOVEMENT_FALLBACK.debuffThreshold,
      base: conf?.movement.baseTicksPerTile ?? MOVEMENT_FALLBACK.base,
      debuff: conf?.movement.debuffTicksPerTile ?? MOVEMENT_FALLBACK.debuff,
    }
    for (const ev of evts) {
      if (ev.type !== 'agent_moved') continue
      const p = ev.payload as { id: string; x: number; y: number }
      const e = entries.get(p.id)
      if (e === undefined) continue
      const last = e.path[e.path.length - 1]!
      const dx = p.x - last.x
      const dy = p.y - last.y
      e.facing = facingFrom(dx, dy) ?? e.facing // a body that has not moved keeps its facing
      // The leg's length comes from the record: `ticksPerTileOf` is the engine's own rule, where
      // a body under the debuff threshold takes twice as many ticks per tile.
      const perTile = ticksPerTileOf(state.agents[p.id]?.needs ?? {}, cfg)
      e.legMs = clock.periodMs * perTile
      e.path = scheduleLeg(e.path, p.x, p.y, {
        nowMs: now,
        legMs: e.legMs,
        leadMs: clock.periodMs * WALK_LEAD_TICKS,
      })
    }
    // emote triggers ride the same delta batches (one batch per tick)
    for (const [agentId, e] of entries) {
      const a = state.agents[agentId]
      if (a === undefined) continue
      const kind = emoteFor(a, evts)
      if (kind !== null && emoteAtlas !== null) {
        e.emote.texture = new Texture({
          source: emoteAtlas.source,
          frame: new Rectangle(EMOTE_KINDS.indexOf(kind) * EMOTE_PX, 0, EMOTE_PX, EMOTE_PX),
        })
        e.emoteUntil = now + EMOTE_MS
      }
    }
  })

  const tick = (nowMs: number): void => {
    recutOnZoom()
    const state = store.getState()
    if (state === null) return
    // hot swap: new codex records re-resolve every character's art in place
    const seq = store.assetsSeq()
    if (seq !== lastAssetsSeq) {
      lastAssetsSeq = seq
      for (const agentId of entries.keys()) {
        const prev = sheets.get(agentId)
        const next = characterArt(store.assetRecords(), agentId)
        if (prev === undefined || prev.art.url !== next.url)
          loadSheet(agentId, prev?.art.url ?? null)
      }
    }
    const live = new Set<string>()
    // Two passes: a rank belongs to a TILE, not to a body, so where each one stands depends on
    // who else is there and every position must settle before any of them is drawn.
    const standing: Array<{ id: string; x: number; y: number; settled: boolean }> = []
    const drawing: Array<{
      a: { id: string; name: string }
      e: CharEntry
      pos: { x: number; y: number }
      bobY: number
    }> = []
    for (const a of Object.values(state.agents)) {
      if (!rendersOnMap(a)) continue
      live.add(a.id)
      const e = ensure(a.id, a.x, a.y)
      // scrubbed views teleport: past positions are facts, not animation
      if (!store.getMode().live) {
        e.path = [{ x: a.x, y: a.y, atMs: nowMs }]
      }
      e.path = prunePath(e.path, nowMs)
      const pos = interpolatePos(e.path, nowMs)
      const walking = e.path.length > 1 && nowMs < e.path[e.path.length - 1]!.atMs
      // while walking, face the current leg; the event-time facing stays as the
      // idle orientation after arrival
      if (walking) e.facing = legFacing(e.path) ?? e.facing
      const sheet = sheets.get(a.id)
      const pose = charPose(
        {
          asleep: a.asleep,
          collapsed: a.collapsedSinceTick !== null,
          walking,
          facing: e.facing,
          nowMs,
        },
        strideFrameMs(e.legMs, e.gait.stride),
        { phase: e.gait.phase, bob: scene.wantsMotion() },
      )
      if (sheet !== undefined && sheet.texture !== null) {
        const cell = characterCell(sheet.texture, sheet.art, pose.row, pose.facing)
        if (cell !== null) {
          e.sprite.texture = cell.texture
          e.sprite.anchor.set(cell.anchor.x, cell.anchor.y) // feet-anchor law
          e.sprite.scale.set(cell.scale) // smooth downscale to world footprint
          setHitScale(e, cell.scale, cell.figureH)
        }
      }
      standing.push({ id: a.id, x: pos.x, y: pos.y, settled: !walking })
      drawing.push({ a, e, pos, bobY: pose.bobY })
    }

    // ── pass two: the rank, then everything that hangs off a body's position ────────────────
    const ranks = crowdOffsets(standing)
    for (const { a, e, pos, bobY } of drawing) {
      // A slot change is a glide, not a jump: a group re-forms as somebody joins it. Reduced
      // motion gets the destination, which is the point of the arrangement.
      const want = ranks.get(a.id) ?? NO_OFFSET
      // A body that has JOINED a rank may not grow past its neighbour, and one that has left
      // it takes the whole floor back.
      setHitScale(e, e.hitScale, e.figureH, ranks.has(a.id))
      if (want.dx !== e.crowdTo.dx || want.dy !== e.crowdTo.dy) {
        e.crowdFrom = e.crowd
        e.crowdTo = want
        e.crowdSinceMs = nowMs
      }
      const t = scene.wantsMotion()
        ? Math.min(1, Math.max(0, (nowMs - e.crowdSinceMs) / CROWD_SETTLE_MS))
        : 1
      e.crowd =
        t >= 1
          ? e.crowdTo
          : {
              dx: e.crowdFrom.dx + (e.crowdTo.dx - e.crowdFrom.dx) * t,
              dy: e.crowdFrom.dy + (e.crowdTo.dy - e.crowdFrom.dy) * t,
            }
      const px = pos.x + e.crowd.dx
      const py = pos.y + e.crowd.dy
      const { sx, sy } = tileToScreen(px, py)
      e.sprite.position.set(sx, sy + bobY)
      e.depth.box = bodyDepthBox(a.id, px, py)
      e.shadow.position.set(sx, sy)
      e.emote.position.set(sx, sy - CHAR_TARGET_PX - EMOTE_ABOVE_HEAD_PX)
      e.emote.visible = !emotesHidden && nowMs < e.emoteUntil && e.emote.texture !== Texture.EMPTY
      const tag = nameTagText(a.name)
      if (e.nameTagLabel.text !== tag) {
        e.nameTagLabel.text = tag
        e.nameTagBg.clear()
        e.nameTagBg.roundRect(
          -e.nameTagLabel.width / 2 - 4,
          -e.nameTagLabel.height - 4,
          e.nameTagLabel.width + 8,
          e.nameTagLabel.height + 8,
          2,
        )
        e.nameTagBg.fill(0xfff6e9)
      }
      // ONE placement rule for every label in the product: above the DRAWN figure,
      // flipped or slid to stay on screen instead of being drawn off the edge of it.
      if (e.nameTag.visible) {
        // The tag holds its size for the reader, so its world FOOTPRINT is what the camera
        // changes — that is the number placeTag de-conflicts against, not the drawn one.
        const inv = worldTextScale(scene.getZoom())
        e.nameTag.scale.set(inv)
        const size = {
          w: (e.nameTagLabel.width + TAG_PAD_X * 2) * inv,
          h: (e.nameTagLabel.height + TAG_PAD_Y * 2) * inv,
        }
        const head = CHAR_TARGET_PX + EMOTE_ABOVE_HEAD_PX + NAME_TAG_ABOVE_HEAD_PX
        const at = placeTag(
          anchorForSprite({ x: sx, y: sy }, { width: SHOULDER_W, height: head }),
          size,
          scene.viewRect(),
        )
        e.nameTag.position.set(Math.round(at.sx), Math.round(at.sy + size.h))
      }
    }
    for (const [agentId, e] of entries) {
      if (!live.has(agentId)) {
        e.sprite.destroy()
        e.shadow.destroy()
        e.emote.destroy()
        e.nameTag.destroy({ children: true })
        entries.delete(agentId)
        sheets.delete(agentId)
      }
    }
  }

  return {
    tick,
    setEmotesHidden: (v) => {
      emotesHidden = v
    },
    getSprite: (agentId) => entries.get(agentId)?.sprite ?? null,
    destroy: () => {
      offEvents()
      for (const e of entries.values()) {
        e.sprite.destroy()
        e.shadow.destroy()
        e.emote.destroy()
        e.nameTag.destroy({ children: true })
      }
      entries.clear()
      shadowTexture.destroy(true)
    },
  }
}
