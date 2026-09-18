import { Graphics, Polygon, Rectangle, Sprite, Texture } from 'pixi.js'
import type { SimEvent } from '@sj/shared'
import { tilesPerTickFor } from '@sj/engine/verbs'
import type { AgentBody, WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { clearBody } from './three/clearance.js'
import { bodyDepthBox } from './depth.js'
import { facingFrom, feetOf, tileToScreen, type Facing } from './iso.js'
import type { DepthEntry } from './layers.js'
import type { Scene } from './scene.js'
import {
  HIT_MIN_PX,
  SHOULDER_W,
  bodyHitPolygon,
  inflateToMin,
  lyingHitPolygon,
} from './hitShapes.js'
import { anchorForSprite } from './tooltip.js'
import { shadowCast } from '../ui/skyModel.js'
import {
  artOptional,
  characterArt,
  raiseWaiting,
  rankInView,
  type TextureBook,
} from './textures.js'
import {
  SLOT_ABOVE_HEAD_PX,
  SLOT_PX,
  caretLit,
  createOverhead,
  overheadRow,
  type Overhead,
} from './overhead.js'
import { hoverPlate } from '../ui/interaction.js'
import { statusOf } from '../ui/status.js'
import { createConversation, faceInScene, floorHolder } from './converse.js'
import { progress } from '../ui/motion.js'
import { drainTint } from './tension.js'
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
  SHEET_COLS,
  SHEET_ROWS,
  WALK_LOOP,
  WALK_LEAD_TICKS,
  cellRowLadder,
  charPose,
  gaitOf,
  initialTickClock,
  interpolatePos,
  legFacing,
  observeTick,
  prunePath,
  scheduleLeg,
  strideFrameMs,
  type EmoteKind,
  type Gait,
  type SheetRow,
  type TickClock,
  type Waypoint,
} from './charAnim.js'

const SHADOW_ALPHA = 0.25
const EMOTE_PX = 16

/** How long the old facing lies over the new one on a turn. Long enough to read as a turn,
 *  short enough that nobody sees two bodies. */
const TURN_FADE_MS = 90

/** The floor of a scene, drawn on the ground the speaker is standing on: 2:1 like the tile, and
 *  a shade wider than the 20×8 contact shadow so it reads as a ring and not as an outline. */
const FLOOR_RING_RX = 12
const FLOOR_RING_RY = 6
const FLOOR_RING_INK = 0xf2c879 // --honey, the one accent

/** The movement law's defaults, restated for a world whose snapshot has not arrived; `charAnim.test.ts` asserts these are what `shared/src/config.ts` defaults to. */
export const MOVEMENT_FALLBACK = { debuffThreshold: 30, base: 3, debuff: 2 } as const

type CharArt = ReturnType<typeof characterArt>
type Sheet = { art: CharArt; texture: Texture | null }

type CharEntry = {
  sprite: Sprite
  shadow: Sprite
  /** the honey ring that says this body holds the floor, and the fade it is part-way through */
  ring: Graphics
  ringA: number
  ringFrom: number
  ringWant: number
  ringSinceMs: number
  overhead: Overhead
  /** the kind the slot is drawing, so the atlas is cut once and not once a frame */
  glyphKind: EmoteKind | null
  /** a provider call is in flight for this body AND the shot is about it, and when that began */
  deciding: boolean
  caretSinceMs: number
  /** the pointer is on this body, so the ONE hover plate is theirs this frame */
  hovered: boolean
  hit: Polygon
  /** the sheet's own figure height, so the capsule follows the art rather than a second table */
  figureH: number
  hitScale: number
  /** standing in a rank, so the 24 px floor may not grow this capsule past one pitch */
  ranked: boolean
  /** asleep or collapsed: the same body, lying across its ground point rather than standing on it */
  lying: boolean
  facing: Facing
  ground: { x: number; y: number } | null
  path: Waypoint[]
  /** this body's own phase and stride, derived once from its id and never again */
  gait: Gait
  /** what the record says the leg in flight costs, so the legs can match the ground */
  legMs: number
  walkCycles: number
  lastPoseAtMs: number
  /** the tile the body is standing on RIGHT NOW — interpolated, never rounded (F-3c), held in
   *  the one entry this body publishes every frame rather than rebuilt into a fresh pair */
  depth: DepthEntry
  /** where in its tile's rank this body is standing, and where it is sliding to. A world
   *  offset, so the box, the cull, the shadow and every label follow it for free. */
  crowd: CrowdOffset
  crowdFrom: CrowdOffset
  crowdTo: CrowdOffset
  crowdSinceMs: number
  /** the vertical multiplier an effect is holding over this body's own scale */
  mulY: number
  /** the breath's own multiplier, composed with `mulY` rather than fighting it */
  breath: number
  /** the facing the sprite is drawn on, so a turn cross-fades off the one being left */
  drawn: Facing | null
  /** the outgoing facing, fading out over the new one for TURN_FADE_MS */
  ghost: Sprite
  ghostSinceMs: number
}

export type CharacterLayer = {
  tick(nowMs: number): void
  setEmotesHidden(v: boolean): void
  getSprite(agentId: string): Sprite | null
  /** An effect publishes a multiplier; this layer composes it with the scale it owns. */
  setScaleMulY(agentId: string, k: number): void
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
export function rendersOnMap(a: { alive: boolean; insideId?: string | undefined }): boolean {
  return a.alive && a.insideId === undefined
}

export type CharacterCell = {
  texture: Texture
  anchor: { x: number; y: number }
  scale: number
  /** the sheet's own figure height, so a caller sizing anything off the art has one source */
  figureH: number
  /** the row the sheet actually had, which is not always the row that was asked for */
  row: SheetRow
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
      row,
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
      row: r,
    }
  }
  return null
}

/** Where the act this body is doing is happening: the person it names, else the structure,
 *  else the tile. A body works facing its work, not facing wherever it last walked from. */
function activityTarget(state: WorldState, a: AgentBody): { x: number; y: number } | null {
  const p = a.activity?.params
  if (p === undefined) return null
  const who = typeof p.targetId === 'string' ? state.agents[p.targetId] : undefined
  if (who !== undefined) return { x: who.x, y: who.y }
  const s = typeof p.structureId === 'string' ? state.structures[p.structureId] : undefined
  if (s !== undefined) return { x: s.x + (s.w - 1) / 2, y: s.y + (s.h - 1) / 2 }
  if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
  return null
}

export function createCharacterLayer(
  scene: Scene,
  book: TextureBook,
  store: WorldStore,
  onSelect: (agentId: string) => void,
): CharacterLayer {
  const targetPx = scene.spatial ? 40 : CHAR_TARGET_PX
  const entries = new Map<string, CharEntry>()
  const sheets = new Map<string, Sheet>() // agentId → resolved art + loaded texture
  let lastAssetsSeq = store.assetsSeq()
  /** Whether a delta has arrived. The codex catch-up rides the hello, ahead of every delta, so
   *  a town still at zero records by then has none and its people wear the gateway's sheet. */
  let sawDelta = false
  let emoteAtlas: Texture | null = null
  let emotesHidden = false
  /** Who is answering whom, so a talker turns to their partner rather than out to sea. */
  const talk = createConversation()
  /** ONE clock for the whole town: the world ticks for everybody at once, so a per-body
   *  estimate would be five noisy copies of one number. */
  let clock: TickClock = initialTickClock()
  void book.get('/assets/emotes.png').then((t) => {
    emoteAtlas = t
    // The sheets land after the first frames, so every slot already showing a row re-cuts.
    for (const e of entries.values()) e.glyphKind = null
  }, artOptional)

  /** Where a body stands in the shot, so its sheet is ranked by the same rule its neighbours'
   *  buildings are: what the camera can see loads before what it cannot. */
  const sheetRank = (sx: number, sy: number): number => rankInView(scene.viewRect(), sx, sy)

  const loadSheet = (agentId: string, swapFrom: string | null, sx: number, sy: number): void => {
    // The codex IS the manifest. Ahead of it a body cannot be told from one the codex has no
    // atlas for, and asking anyway spent 400 KB a body on sheets the atlas replaced.
    if (store.assetsSeq() === 0 && !sawDelta) return
    const art = characterArt(store.assetRecords(), agentId)
    const sheet: Sheet = { art, texture: null }
    sheets.set(agentId, sheet)
    const p =
      swapFrom !== null && swapFrom !== art.url
        ? book.swap(swapFrom, art.url)
        : book.get(art.url, sheetRank(sx, sy))
    void p.then((t) => {
      if (sheets.get(agentId) !== sheet) return // superseded by a newer resolve
      sheet.texture = t
    }, artOptional)
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
  const setHitScale = (
    e: CharEntry,
    scale: number,
    figureH: number,
    ranked = e.ranked,
    lying = e.lying,
  ): void => {
    if (e.hitScale === scale && e.figureH === figureH && e.ranked === ranked && e.lying === lying)
      return
    e.hitScale = scale
    e.figureH = figureH
    e.ranked = ranked
    e.lying = lying
    e.hit.points = inflateToMin(
      lying ? lyingHitPolygon(figureH, scale) : bodyHitPolygon(figureH, scale),
      HIT_MIN_PX,
      scale * hitZoom,
      ranked ? CROWD_PITCH_PX * hitZoom : Infinity,
    )
  }
  // The inflation floor is a SCREEN size, so a zoom change re-cuts every capsule. Cheap: it
  // fires on a camera stop, not on a frame.
  const recutOnZoom = (): void => {
    const zoom = scene.getZoomStop()
    if (zoom === hitZoom) return
    hitZoom = zoom
    for (const e of entries.values()) {
      const scale = e.hitScale,
        figureH = e.figureH
      e.hitScale = 0
      setHitScale(e, scale, figureH)
    }
  }

  /** The atlas cell for the row the slot is showing. Cut once per kind for the whole layer:
   *  Pixi's Texture holds a listener on its source that only `destroy()` takes off again. */
  const setGlyph = (e: CharEntry, kind: EmoteKind | null): void => {
    if (e.glyphKind === kind) return
    e.glyphKind = kind
    // Check the index: `indexOf` answers -1 for a kind the sheet lacks, and a frame cut off the
    // left of the atlas is the forge's checkerboard standing over somebody's head.
    const cell = kind === null ? -1 : EMOTE_KINDS.indexOf(kind)
    if (cell < 0 || emoteAtlas === null) {
      e.overhead.glyph.texture = Texture.EMPTY
      return
    }
    const atlas = emoteAtlas
    e.overhead.glyph.texture = cached(
      atlas,
      `emote:${kind}`,
      () =>
        new Texture({
          source: atlas.source,
          frame: new Rectangle(cell * EMOTE_PX, 0, EMOTE_PX, EMOTE_PX),
        }),
    )
    e.overhead.glyph.width = EMOTE_PX
    e.overhead.glyph.height = EMOTE_PX
  }

  const ensure = (agentId: string, x: number, y: number): CharEntry => {
    let e = entries.get(agentId)
    if (e !== undefined) {
      if (!sheets.has(agentId)) loadSheet(agentId, null, e.sprite.position.x, e.sprite.position.y)
      return e
    }
    const sprite = new Sprite()
    sprite.anchor.set(0.5, FEET_Y / CELL)
    sprite.scale.set(targetPx / 64)
    sprite.eventMode = 'static'
    sprite.cursor = 'pointer'
    const hit = new Polygon(bodyHitPolygon(64, targetPx / 64))
    sprite.hitArea = hit
    sprite.on('pointertap', () => {
      onSelect(agentId)
    })
    // The turn's own art: the outgoing cell, riding the body's transform as a child so the
    // depth sort keeps owning where it is drawn.
    const ghost = new Sprite()
    ghost.eventMode = 'none'
    ghost.visible = false
    sprite.addChild(ghost)
    const shadow = new Sprite(shadowTexture)
    shadow.anchor.set(0.5, 0.5)
    shadow.alpha = SHADOW_ALPHA
    shadow.eventMode = 'none'
    const ring = new Graphics()
    ring.ellipse(0, 0, FLOOR_RING_RX, FLOOR_RING_RY)
    ring.stroke({ width: 1, color: FLOOR_RING_INK })
    ring.eventMode = 'none'
    ring.alpha = 0
    ring.visible = false
    // each companion to the layer it belongs in: a contact shadow under every body, the
    // overhead slot and the plate over every body. None competes with the depth sort any more.
    // The ring is a mark on the GROUND, so it goes in with the other ground decals.
    scene.layers.shadow.addChild(shadow)
    scene.layers.groundDecal.addChild(ring)
    scene.layers.entities.addChild(sprite)
    // ★ ONE SLOT over the head, and the track wraps it exactly while a job runs.
    const overhead = createOverhead(scene.layers.worldText)
    // ★ ONE PLATE FOR THE WHOLE STAGE, the same one a building wears. The layer owns it, so a
    // person's plate is placed and de-conflicted by the rule every other label goes through.
    sprite.on('pointerover', () => {
      e2.hovered = true
    })
    sprite.on('pointerout', () => {
      e2.hovered = false
      scene.tags.hide('hover')
    })
    const now = performance.now()
    const e2: CharEntry = {
      sprite,
      shadow,
      ring,
      ringA: 0,
      ringFrom: 0,
      ringWant: 0,
      ringSinceMs: now,
      overhead,
      glyphKind: null,
      deciding: false,
      caretSinceMs: now,
      hovered: false,
      hit,
      figureH: 0,
      hitScale: 0,
      ranked: false,
      lying: false,
      facing: 'sw',
      ground: null,
      gait: gaitOf(agentId),
      legMs: clock.periodMs / MOVEMENT_FALLBACK.base,
      walkCycles: 0,
      lastPoseAtMs: now,
      path: [{ x, y, atMs: now }],
      depth: { box: bodyDepthBox(agentId, x, y), node: sprite, overhead: overhead.node },
      crowd: NO_OFFSET,
      crowdFrom: NO_OFFSET,
      crowdTo: NO_OFFSET,
      crowdSinceMs: now,
      mulY: 1,
      breath: 1,
      drawn: null,
      ghost,
      ghostSinceMs: now,
    }
    e = e2
    setHitScale(e, targetPx / 64, 64)
    entries.set(agentId, e)
    const feet = feetOf(x, y)
    loadSheet(agentId, null, feet.sx, feet.sy)
    return e
  }

  /** The old cell lies over the new one and fades, so a turn is a turn and not an atlas swap. */
  const startTurn = (e: CharEntry, nowMs: number): void => {
    e.ghost.texture = e.sprite.texture
    e.ghost.anchor.set(e.sprite.anchor.x, e.sprite.anchor.y)
    e.ghost.alpha = 1
    e.ghost.visible = true
    e.ghostSinceMs = nowMs
  }

  const offEvents = store.onEvents((evts: SimEvent[]) => {
    sawDelta = true
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
      base: conf?.movement.baseTilesPerTick ?? MOVEMENT_FALLBACK.base,
      debuff: conf?.movement.debuffTilesPerTick ?? MOVEMENT_FALLBACK.debuff,
    }
    for (const ev of evts) {
      if (ev.type === 'agent_spoke') {
        const s = ev.payload as { agentId: string; x: number; y: number }
        talk.heard({ agentId: s.agentId, x: s.x, y: s.y, atMs: now })
        continue
      }
      if (ev.type !== 'agent_moved') continue
      const p = ev.payload as { id: string; x: number; y: number }
      const e = entries.get(p.id)
      if (e === undefined) continue
      const last = e.path[e.path.length - 1]!
      const dx = p.x - last.x
      const dy = p.y - last.y
      e.facing = facingFrom(dx, dy) ?? e.facing // a body that has not moved keeps its facing
      // The leg's length comes from the record: `tilesPerTickFor` is the engine's own rule, and
      // a tick is shared out among the tiles it carried.
      const perTick = tilesPerTickFor(state.agents[p.id]?.needs ?? {}, cfg)
      e.legMs = clock.periodMs / perTick
      e.path = scheduleLeg(e.path, p.x, p.y, {
        nowMs: now,
        legMs: e.legMs,
        leadMs: clock.periodMs * WALK_LEAD_TICKS,
      })
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
      for (const [agentId, e] of entries) {
        const prev = sheets.get(agentId)
        const next = characterArt(store.assetRecords(), agentId)
        if (prev?.art.url !== next.url)
          loadSheet(agentId, prev?.art.url ?? null, e.sprite.position.x, e.sprite.position.y)
      }
    }
    // `rig.fitToTown` is still running when the first bodies ask, so the shot they were ranked
    // against is not the shot. Only a sheet still waiting can move.
    const shot = scene.viewRect()
    for (const [agentId, e] of entries) {
      const sheet = sheets.get(agentId)
      if (sheet?.texture !== null) continue
      raiseWaiting(sheet.art.url, rankInView(shot, e.sprite.position.x, e.sprite.position.y))
    }
    const nowTick = store.getTick()
    const wantsMotion = scene.wantsMotion()
    // An open scene turns its cast toward each other and puts the ring under whoever has it.
    const open = store.shotScene()
    const cast = open?.open === true ? open.participants : null
    const heard = talk.voices()
    const inScene = new Set(cast ?? [])
    // Only the shot's cast and the viewer's own pick wear a caret: twelve lit at once is
    // twelve loading spinners, which says the page is broken rather than that these are minds.
    const minds = store.minds()
    const floor = cast === null ? null : floorHolder(cast, heard)
    const live = new Set<string>()
    // Two passes: a rank belongs to a TILE, not to a body, so where each one stands depends on
    // who else is there and every position must settle before any of them is drawn.
    const standing: { id: string; x: number; y: number; settled: boolean }[] = []
    const drawing: {
      a: AgentBody
      e: CharEntry
      pos: { x: number; y: number }
      walking: boolean
    }[] = []
    for (const a of Object.values(state.agents)) {
      if (!rendersOnMap(a)) continue
      live.add(a.id)
      const e = ensure(a.id, a.x, a.y)
      // a still view teleports: a pinned position is a fact, not animation. A replay walks.
      if (!store.timeMoving()) {
        e.path = [{ x: a.x, y: a.y, atMs: nowMs }]
      }
      e.path = prunePath(e.path, nowMs)
      const pos = interpolatePos(e.path, nowMs)
      const walking = e.path.length > 1 && nowMs < e.path[e.path.length - 1]!.atMs
      // while walking, face the current leg; the event-time facing stays as the
      // idle orientation after arrival
      // A scene outranks the exchange rule: it says who the room is listening to, where
      // `partnerOf` can only guess from earshot.
      const toward = inScene.has(a.id) ? faceInScene(a.id, cast!, heard) : null
      if (walking) e.facing = legFacing(e.path) ?? e.facing
      else if (toward !== null) {
        const at = state.agents[toward]
        if (at !== undefined) e.facing = facingFrom(at.x - pos.x, at.y - pos.y) ?? e.facing
      } else if (statusOf(a, nowTick) === 'talking') {
        // Turned toward whoever they are answering: two talkers facing where they last walked
        // read as two people, not as an exchange.
        const partner = talk.partnerOf(a.id, pos.x, pos.y, nowMs)
        const at = partner === null ? undefined : state.agents[partner]
        if (at !== undefined) e.facing = facingFrom(at.x - pos.x, at.y - pos.y) ?? e.facing
      } else {
        // Face what you are doing. Without this a body keeps the direction of the last walk
        // leg for the whole act, which is the back of its head half the time.
        const at = activityTarget(state, a)
        if (at !== null) e.facing = facingFrom(at.x - pos.x, at.y - pos.y) ?? e.facing
      }
      standing.push({ id: a.id, x: pos.x, y: pos.y, settled: !walking })
      drawing.push({ a, e, pos, walking })
    }

    // ── pass two: the rank, then everything that hangs off a body's position ────────────────
    const ranks = crowdOffsets(standing)
    // once a frame for every body: the sun's height is a function of the minute, not of who
    const sun = shadowCast(nowTick)
    const solid = scene.spatial ? Object.values(state.structures) : []
    for (const { a, e, pos, walking } of drawing) {
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
      const ground = scene.spatial ? clearBody(px + 0.5, py + 0.5, solid) : null
      const visible = ground ?? { x: px, y: py }
      if (walking && e.ground) {
        const dx = visible.x - e.ground.x
        const dy = visible.y - e.ground.y
        if (Math.hypot(dx, dy) > 0.0001) e.facing = facingFrom(dx, dy) ?? e.facing
      }
      e.ground = visible
      const sheet = sheets.get(a.id)
      const frameMs = strideFrameMs(e.legMs, e.gait.stride)
      const elapsed = Math.min(100, Math.max(0, nowMs - e.lastPoseAtMs))
      e.lastPoseAtMs = nowMs
      // Cadence changes must not rewind the pose already in flight.
      if (walking) e.walkCycles = (e.walkCycles + elapsed / (frameMs * WALK_LOOP.length)) % 1
      const pose = charPose(
        {
          asleep: a.asleep,
          collapsed: a.collapsedSinceTick !== null,
          walking,
          facing: e.facing,
          nowMs: walking ? 0 : nowMs,
        },
        frameMs,
        { phase: e.gait.phase + (walking ? e.walkCycles : 0), bob: scene.wantsMotion() },
      )
      e.breath = pose.breathY
      if (sheet !== undefined && sheet.texture !== null) {
        const cell = characterCell(sheet.texture, sheet.art, pose.row, pose.facing)
        if (cell !== null) {
          if (pose.facing !== e.drawn) {
            if (e.drawn !== null && wantsMotion) startTurn(e, nowMs)
            e.drawn = pose.facing
          }
          e.sprite.texture = cell.texture
          e.sprite.anchor.set(cell.anchor.x, cell.anchor.y) // feet-anchor law
          e.sprite.scale.set((cell.scale * targetPx) / CHAR_TARGET_PX) // smooth downscale to world footprint
          // the row the SHEET had: a sheet with no sleep row draws a standing body
          setHitScale(
            e,
            (cell.scale * targetPx) / CHAR_TARGET_PX,
            cell.figureH,
            e.ranked,
            cell.row === 'sleep',
          )
        }
      }
      const { sx, sy } = ground ? tileToScreen(ground.x, ground.y) : feetOf(px, py)
      e.sprite.position.set(sx, sy + pose.bobY)
      e.depth.box = bodyDepthBox(a.id, px, py)
      // ★ The sun's own height, off the same token the arc draws: a low sun draws the blob
      // out and lays it away from the light, and noon puts it back under the feet.
      e.shadow.position.set(sx + sun.dx, sy)
      e.shadow.scale.set(sun.scaleX, sun.scaleY)
      e.shadow.alpha = SHADOW_ALPHA * sun.alpha
      // On the ground, not on the body: the ring takes the shadow's point, so an idle bob
      // does not lift it off the tile.
      e.ring.position.set(sx, sy)
      const hasFloor = a.id === floor ? 1 : 0
      if (hasFloor !== e.ringWant) {
        e.ringFrom = e.ringA
        e.ringWant = hasFloor
        e.ringSinceMs = nowMs
      }
      const fade = wantsMotion ? progress('reveal', e.ringSinceMs, nowMs) : 1
      e.ringA = e.ringFrom + (hasFloor - e.ringFrom) * fade
      e.ring.alpha = e.ringA
      e.ring.visible = !scene.spatial && e.ringA > 0
      const drain = store.tension.desaturate(a.id, nowMs)
      if (drain > 0 || e.sprite.tint !== 0xffffff) e.sprite.tint = drainTint(drain)
      e.sprite.scale.y = e.sprite.scale.x * e.mulY * e.breath
      if (e.ghost.visible) {
        const p = (nowMs - e.ghostSinceMs) / TURN_FADE_MS
        e.ghost.alpha = Math.max(0, 1 - p)
        e.ghost.visible = p < 1
      }
      const status = emotesHidden ? null : overheadRow(a, nowTick)
      const deciding =
        minds.get(a.id)?.state === 'deciding' &&
        (inScene.has(a.id) || a.id === scene.pickedId) &&
        a.alive
      const token = status?.id === 'asleep' || statusOf(a, nowTick) === 'working' || deciding
      const row =
        scene.spatial && (status?.id === 'talking' || (!status?.urgent && token)) ? null : status
      e.overhead.node.position.set(sx, sy - targetPx - SLOT_ABOVE_HEAD_PX - SLOT_PX / 2)
      setGlyph(e, row?.glyph ?? null)
      e.overhead.setRow(row)
      if (deciding !== e.deciding) {
        e.deciding = deciding
        e.caretSinceMs = nowMs
      }
      const lit = deciding && !scene.spatial ? caretLit(e.caretSinceMs, nowMs, wantsMotion) : 0
      e.overhead.setCaret(lit)
      e.overhead.node.visible = row !== null || lit > 0
      // ONE placement rule for every label in the product, and the layer applies it: the plate
      // is welded to the feet and only leaves them when the view has no room down there. Said
      // every frame, because the body it names walks.
      if (e.hovered) {
        // The head box is what the plate flips ABOVE into, so it measures what is drawn there:
        // the slot, at its own offset, and nothing that used to be.
        const head = targetPx + SLOT_ABOVE_HEAD_PX + SLOT_PX
        scene.tags.show(
          'hover',
          hoverPlate(state, 'agent', a.id, a.id === scene.pickedId),
          anchorForSprite({ x: sx, y: sy }, { width: SHOULDER_W, height: head }),
        )
      }
    }
    for (const [agentId, e] of entries) {
      if (!live.has(agentId)) {
        e.ghost.destroy()
        e.sprite.destroy()
        e.shadow.destroy()
        e.ring.destroy()
        e.overhead.destroy()
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
    setScaleMulY: (agentId, k) => {
      const e = entries.get(agentId)
      if (e === undefined) return
      e.mulY = k
      // written now as well as in `tick`: the character layer ticks BEFORE the effects do, so
      // waiting for the next frame would show the squash one frame late.
      e.sprite.scale.y = e.sprite.scale.x * k * e.breath
    },
    destroy: () => {
      offEvents()
      for (const e of entries.values()) {
        e.ghost.destroy()
        e.sprite.destroy()
        e.shadow.destroy()
        e.ring.destroy()
        e.overhead.destroy()
      }
      entries.clear()
      shadowTexture.destroy(true)
    },
  }
}
