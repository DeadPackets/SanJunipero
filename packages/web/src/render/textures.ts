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

/** A browser holds six connections open to one origin. More in flight than that hands the
 *  ordering back to the network, which is the one thing the queue exists to take. */
const MAX_IN_FLIGHT = 6

/** Pixi's `Assets` registry is one global alias table, so the book over it is one book: two
 *  would be two views of it, and a swap in either unloads a source the other still hands out. */
const cache = new Map<string, Promise<Texture>>()
const ready = new Map<string, Texture>()
const registered = new Set<string>()
const artClass = new Map<string, AssetClass>()

type Wanted = { priority: number; start: () => void }
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
      priority,
      start: () => {
        void Assets.load<Texture>(url)
          .then(resolve, reject)
          .finally(() => {
            inFlight--
            pump()
          })
      },
    })
    pump()
  })
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

let outstanding = 0
let dressedYet = false
let booted = false
let firstFrame: readonly AssetClass[] = []
const asked = new Set<string>()
const waitingOnArt = new Set<() => void>()

/** Resolves once every class the first frame is made of has answered, or after `timeoutMs`. A
 *  card that leaves on the scene object reveals an empty field that fills in afterwards. */
export function whenDressed(timeoutMs = DRESSED_TIMEOUT_MS): Promise<void> {
  if (dressedYet) return Promise.resolve()
  return new Promise<void>((resolve) => {
    waitingOnArt.add(resolve)
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

function settled(): void {
  outstanding--
  if (dressedYet || !booted || outstanding > 0 || asked.size === 0) return
  const seen = askedClasses()
  for (const k of firstFrame) if (!seen.has(k)) return
  dressedYet = true
  for (const release of waitingOnArt) release()
  waitingOnArt.clear()
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
      outstanding++
      p = fetchTexture(url, priority ?? rankOf(url)).then(
        (t) => {
          // GCSystem unloads an untouched source, and an unloaded source is a null one that
          // takes the stage down on the next frame that draws it.
          t.source.autoGarbageCollect = false
          ready.set(url, t)
          settled()
          return t
        },
        (err: unknown) => {
          // A fetch that failed once — a gateway restarting under a live socket — must not be
          // this url's answer for the rest of the session.
          cache.delete(url)
          settled()
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
