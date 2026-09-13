import { Assets, Graphics, type Sprite, type Texture } from 'pixi.js'
import { progress, type MotionName } from '../ui/motion.js'
import {
  parseBuildingManifest,
  parseCharacterAtlasManifest,
  type AssetClass,
  type AssetRecord,
  type BuildingPoints,
  type CellPoint,
  type CharacterAtlasManifest,
} from '@sj/shared'

// (controller ruling) resolution runs on the codex kind column, never on desc parsing
function resolveAsset(records: AssetRecord[], klass: AssetClass, kind: string): AssetRecord | null {
  let best: AssetRecord | null = null
  for (const r of records) {
    if (r.status !== 'ready' || r.class !== klass || r.kind !== kind) continue
    if (best === null || r.seq > best.seq) best = r
  }
  return best
}

export function resolveAssetId(
  records: AssetRecord[],
  klass: AssetClass,
  kind: string,
): string | null {
  return resolveAsset(records, klass, kind)?.id ?? null
}

// character sheets live in the codex as class rig-part, kind character:<agentId>
const CHARACTER_CLASS: AssetClass = 'rig-part'
/** The gateway's own character route, which serves a v2 sheet for an agent the codex has no
 *  atlas for. It is a character sheet by construction, so it counts as one. */
const CHARACTER_ROUTE = '/assets/character/'

export type CharacterArt = {
  url: string
  manifest: CharacterAtlasManifest | null
  size: { w: number; h: number } | null // atlas pixel dims (record widthPx/heightPx)
}

// v4 atlas record → its immutable png + manifest; older/no codex art → the
// gateway's character route (v2 sheet or placeholder) sliced by v2 geometry.
export function characterArt(records: AssetRecord[], agentId: string): CharacterArt {
  const rec = resolveAsset(records, CHARACTER_CLASS, `character:${agentId}`)
  if (rec === null) return { url: `${CHARACTER_ROUTE}${agentId}.png`, manifest: null, size: null }
  const manifest = parseCharacterAtlasManifest(rec.meta)
  if (manifest === null)
    return { url: `${CHARACTER_ROUTE}${agentId}.png`, manifest: null, size: null }
  return { url: `/assets/${rec.id}.png`, manifest, size: { w: rec.widthPx, h: rec.heightPx } }
}

export const BUILDING_PX_PER_TILE = 32 // Style Bible: ~64px sprite for a 1×1 building → fit a 32·(w+h) square

/** `url: null` means NO ART EXISTS for this kind and the renderer draws a palette-true built
 *  form. It must never mean the forge's checkerboard placeholder. */
export type BuildingArt = {
  url: string | null
  anchor: { x: number; y: number } | null
  scale: number | null
  /** the manifest's hand-measured cell points, in cell px; `null` when the art has none */
  points: BuildingPoints | null
}

// v4 hi-res building → feet-anchored, scaled to fit the Style Bible's 32·(w+h) px
// square; anything else draws at natural size with the bottom-center anchor law.
/** The codex kind a turned building draws as. SW is the bare kind, matching what
 *  `forge/buildingArt.facingKind` registers — restated because `@sj/web` cannot import forge. */
export const facingCellKind = (kind: string, facing?: 'sw' | 'se'): string =>
  facing === 'se' ? `${kind}:se` : kind

export function buildingArt(
  records: AssetRecord[],
  kind: string,
  fw: number,
  fh: number,
  facing?: 'sw' | 'se',
): BuildingArt {
  const rec =
    resolveAsset(records, 'building', facingCellKind(kind, facing)) ??
    resolveAsset(records, 'building', kind)
  if (rec === null) return { url: null, anchor: null, scale: null, points: null }
  const m = parseBuildingManifest(rec.meta)
  if (m === null) return { url: `/assets/${rec.id}.png`, anchor: null, scale: null, points: null }
  const target = (fw + fh) * BUILDING_PX_PER_TILE
  return {
    url: `/assets/${rec.id}.png`,
    anchor: { x: m.cell.feetX / m.cell.w, y: m.cell.feetY / m.cell.h },
    scale: Math.min(target / m.cell.w, target / m.cell.h),
    points: m.points ?? null,
  }
}

/** A manifest cell point in the space the sprite stands in, read off the sprite the entity
 *  layer placed. `null` until the art has landed — `Texture.EMPTY` is one pixel wide. */
export function cellPointOf(
  sprite: Pick<Sprite, 'x' | 'y' | 'anchor' | 'scale' | 'texture'>,
  pt: CellPoint,
): { sx: number; sy: number } | null {
  const { width, height } = sprite.texture
  if (width <= 1) return null
  return {
    sx: sprite.x + (pt.x - sprite.anchor.x * width) * sprite.scale.x,
    sy: sprite.y + (pt.y - sprite.anchor.y * height) * sprite.scale.y,
  }
}

/** Pixi's `GCSystem` calls `unload()` on any source with `autoGarbageCollect` that goes
 *  `maxUnusedTime` untouched, and an unloaded source is a null one that takes the stage down. */
export function bakeTexture(
  scene: {
    app: { renderer: { generateTexture(o: { target: Graphics; resolution: number }): Texture } }
  },
  draw: (g: Graphics) => void,
): Texture {
  const g = new Graphics()
  draw(g)
  const tex = scene.app.renderer.generateTexture({ target: g, resolution: 1 })
  tex.source.autoGarbageCollect = false
  g.destroy()
  return tex
}

/** `null` means NO ART EXISTS for this kind and the caller draws its own loading tier. The
 *  forge's checkerboard reads as broken, so no viewer is ever shown one. */
export function textureUrlFor(
  records: AssetRecord[],
  klass: AssetClass,
  kind: string,
): string | null {
  const id = resolveAssetId(records, klass, kind)
  return id === null ? null : `/assets/${id}.png`
}

/** Art is optional: a load that failed leaves the drawable on the stand-in it is already
 *  wearing, and the book will ask again the next time somebody wants it. */
export const artOptional = (): undefined => undefined

// ── THE LOADING ORDER ──────────────────────────────────────────────────

/** What a request is worth. The ground goes down before anything stands on it, what is in the
 *  shot goes before what is not, and a caller that ranks nothing sits between the two. */
export const LOAD_PRIORITY = { ground: 0, near: 1, ordinary: 2, far: 3 } as const

/** What the camera can see goes before what it cannot. One rule for every layer: a body and a
 *  building standing on the same tile must not disagree about whether they are in the shot. */
export function rankInView(
  view: { x: number; y: number; w: number; h: number },
  sx: number,
  sy: number,
): number {
  return sx >= view.x && sx <= view.x + view.w && sy >= view.y && sy <= view.y + view.h
    ? LOAD_PRIORITY.near
    : LOAD_PRIORITY.far
}

/** A browser holds six connections open to one origin. More in flight than that hands the
 *  ordering back to the network, which is the one thing the queue exists to take. */
const MAX_IN_FLIGHT = 6

/** Pixi's `Assets` registry is one global alias table, so the book over it is one book: two
 *  would be two views of it, and a swap in either unloads a source the other still hands out. */
const cache = new Map<string, Promise<Texture>>()
const ready = new Map<string, Texture>()
const registered = new Set<string>()
const artClass = new Map<string, AssetClass>()

type Wanted = { url: string; priority: number; start: () => void; drop: () => void }
const wanted: Wanted[] = []
let inFlight = 0

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && wanted.length > 0) {
    let best = 0
    for (let i = 1; i < wanted.length; i++)
      if (wanted[i]!.priority < wanted[best]!.priority) best = i
    const next = wanted.splice(best, 1)[0]!
    inFlight++
    next.start()
  }
}

function fetchTexture(url: string, priority: number): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    wanted.push({
      url,
      priority,
      start: () => {
        void Assets.load<Texture>(url)
          .then(resolve, reject)
          .finally(() => {
            inFlight--
            pump()
          })
      },
      drop: () => {
        reject(new Error(`dropped ${url}`))
      },
    })
    pump()
  })
}

/** A url the layer has swapped away from before a connection came free. It never started, so
 *  nothing is drawn from it and downloading it now is bytes nobody will ever see. */
function dropWaiting(url: string): void {
  const i = wanted.findIndex((w) => w.url === url)
  if (i >= 0) wanted.splice(i, 1)[0]!.drop()
}

/** A rank read before the camera settled is a guess, and `get` hands back the cached promise
 *  without looking at the new one. Moves a url still WAITING: one in flight cannot be recalled. */
export function raiseWaiting(url: string, priority: number): void {
  for (const w of wanted)
    if (w.url === url && priority < w.priority) {
      w.priority = priority
      if (priority <= LOAD_PRIORITY.near) mustLand.add(url)
    }
}

/** What a url is art of. The codex answers for everything it holds, and the gateway's character
 *  route answers for itself. */
function classOf(url: string): AssetClass | undefined {
  return url.startsWith(CHARACTER_ROUTE) ? CHARACTER_CLASS : artClass.get(url)
}

/** What a caller that named no priority gets: terrain is the ground everything else stands on,
 *  and it is only known to be terrain because the boot manifest said so. */
function rankOf(url: string): number {
  return classOf(url) === 'terrain' ? LOAD_PRIORITY.ground : LOAD_PRIORITY.ordinary
}

function register(url: string): void {
  if (registered.has(url)) return
  registered.add(url)
  Assets.add({ alias: url, src: url })
}

/** The codex IS the boot manifest: it names every url that exists before one sprite asks for a
 *  byte, so a caller that ranks nothing still gets its terrain down before the town on top. */
export function openBoot(records: readonly AssetRecord[]): void {
  const held = new Set<AssetClass>()
  for (const r of records) {
    if (r.status !== 'ready') continue
    const url = `/assets/${r.id}.png`
    artClass.set(url, r.class)
    held.add(r.class)
    register(url)
  }
  firstFrame = FIRST_FRAME_CLASSES.filter((k) => held.has(k))
  booted = true
}

// ── DRESSED IS ART IN HAND ─────────────────────────────────────────────

/** How long the reveal waits. Past this the town is shown as it stands: one dead asset must
 *  never keep the title card up. */
const DRESSED_TIMEOUT_MS = 3000

/** What a first frame is made of: the ground, what stands on it, and the people. Each layer
 *  asks on its own subscription, so the one that asks first must not answer for the rest. */
const FIRST_FRAME_CLASSES: readonly AssetClass[] = ['terrain', 'building', CHARACTER_CLASS]

let dressedYet = false
let booted = false
let firstFrame: readonly AssetClass[] = []
let firstAskMs: number | null = null
let givingUp: ReturnType<typeof setTimeout> | null = null
const asked = new Set<string>()
/** The ground and what is in the shot. Dressed is these in hand, so a reveal is a town rather
 *  than a field of stand-ins with the art still on the wire. */
const mustLand = new Set<string>()
const waitingOnArt = new Set<() => void>()

function giveUp(): void {
  for (const release of waitingOnArt) release()
  waitingOnArt.clear()
}

/** The budget belongs to the LOADING, not to the bundle and the socket in front of it, so it
 *  runs from the first ask: the first moment any art could have been in hand. */
function armGiveUp(): void {
  if (givingUp !== null) return
  const from = firstAskMs ?? performance.now()
  givingUp = setTimeout(giveUp, Math.max(0, from + DRESSED_TIMEOUT_MS - performance.now()))
}

/** The reveal is asked for on mount, which is before the socket has said what the town is, so
 *  a waiter that arrived ahead of the first ask is re-armed against it. */
function noteFirstAsk(): void {
  if (firstAskMs !== null) return
  firstAskMs = performance.now()
  if (givingUp === null) return
  clearTimeout(givingUp)
  givingUp = null
  armGiveUp()
}

/** Resolves once the ground and everything in the shot is in hand, or on the timeout. A card
 *  that leaves on the scene object reveals an empty field that fills in afterwards. */
export function whenDressed(timeoutMs?: number): Promise<void> {
  if (dressedYet) return Promise.resolve()
  return new Promise<void>((resolve) => {
    waitingOnArt.add(resolve)
    if (timeoutMs === undefined) {
      armGiveUp()
      return
    }
    setTimeout(() => {
      waitingOnArt.delete(resolve)
      resolve()
    }, timeoutMs)
  })
}

/** Which classes the book has been asked for, however the request failed or fared. Read off the
 *  asks rather than kept as they arrive: the ground is asked for before the codex is open. */
function askedClasses(): Set<AssetClass> {
  const out = new Set<AssetClass>()
  for (const url of asked) {
    const k = classOf(url)
    if (k !== undefined) out.add(k)
  }
  return out
}

function settled(url: string): void {
  mustLand.delete(url)
  if (dressedYet || !booted || mustLand.size > 0 || asked.size === 0) return
  const seen = askedClasses()
  for (const k of firstFrame) if (!seen.has(k)) return
  dressedYet = true
  giveUp()
}

export class TextureBook {
  /** The texture if it is already in hand, so a caller can paint it in the frame it asks:
   *  even a resolved Promise defers `.then` to a microtask, one frame after the render. */
  peek(url: string): Texture | null {
    return ready.get(url) ?? null
  }

  get(url: string, priority?: number): Promise<Texture> {
    let p = cache.get(url)
    if (p === undefined) {
      register(url)
      asked.add(url)
      const rank = priority ?? rankOf(url)
      if (rank <= LOAD_PRIORITY.near) mustLand.add(url)
      noteFirstAsk()
      p = fetchTexture(url, rank).then(
        (t) => {
          // GCSystem unloads an untouched source, and an unloaded source is a null one that
          // takes the stage down on the next frame that draws it.
          t.source.autoGarbageCollect = false
          ready.set(url, t)
          settled(url)
          return t
        },
        (err: unknown) => {
          // A fetch that failed once — a gateway restarting under a live socket — must not be
          // this url's answer for the rest of the session.
          cache.delete(url)
          settled(url)
          throw err
        },
      )
      cache.set(url, p)
    }
    return p
  }

  /** NOT `Assets.unload`: that destroys the texture and nulls its source, and the batcher reads
   *  `source.alphaMode` unguarded, so the stage goes down on the next frame that draws it. */
  async swap(oldUrl: string, newUrl: string): Promise<Texture> {
    if (oldUrl !== newUrl) dropWaiting(oldUrl)
    const next = await this.get(newUrl) // free the old source only once the new one is in hand
    if (oldUrl !== newUrl) {
      ready.get(oldUrl)?.source.unload()
      ready.delete(oldUrl)
      cache.delete(oldUrl)
    }
    return next
  }
}

// ── NOTHING POPS IN ───────────────────────────────────────────────────

/** The motion a swapped-in texture arrives on. */
const ART_FADE: MotionName = 'reveal'

/** How long the dressing takes to run from the middle of the shot out to its corner. */
const DRESS_SWEEP_MS = 240

/** The wait before a first arrival fades up, by how far it stands from the middle of the shot.
 *  The town then comes into focus outward instead of every object blinking in on one frame. */
export function dressDelay(dist: number, span: number): number {
  if (!(span > 0)) return 0
  return Math.min(1, Math.max(0, dist) / span) * DRESS_SWEEP_MS
}

/** Fades a node from nothing to itself over `ART_FADE`, after `delayMs`. Node-safe: with no rAF
 *  (a test, a worker) the art simply arrives, which is the old behaviour and never a hole. */
export function fadeArtIn(node: { alpha: number; destroyed: boolean }, delayMs = 0): void {
  if (typeof requestAnimationFrame !== 'function') return
  const started = performance.now() + delayMs
  node.alpha = 0
  const step = (): void => {
    if (node.destroyed) return
    const t = progress(ART_FADE, started, performance.now())
    node.alpha = t
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
