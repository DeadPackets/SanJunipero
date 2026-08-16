import { Graphics, Sprite, type FederatedPointerEvent } from 'pixi.js'
import { tickToMoment } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { depthKey, tileToScreen } from './iso.js'
import type { Scene } from './scene.js'
import { TextureBook, buildingArt, smoothSource, textureUrlFor, type BuildingArt } from './textures.js'

export const CONSTRUCTION_TINT = 0xcfc6bc
export const WITHERED_TINT = 0x857d75
export const ITEM_PX = 24
export const CROP_SCALE_BASE = 0.4
export const CROP_SCALE_PER_STAGE = 0.15
export const PIP_COUNT = 4
export const PIP_COLOR = 0xf2c879
export const BUILD_TICKS_FULL = 2880 // pip denominator — DEFAULT_CONFIG construction.hutTicks; presentation only

type Entry = { sprite: Sprite; url: string; pips: Graphics | null }
type SyncState = { entries: Map<string, Entry>; lastAssetsSeq: number }
const syncStates = new WeakMap<Scene, SyncState>()

function setTexture(book: TextureBook, entry: Entry, url: string): void {
  entry.url = url
  void book.get(url).then((t) => {
    if (entry.url === url) entry.sprite.texture = t
  })
}

// v4 hi-res buildings anchor at the manifest feet point and downscale smoothly to the
// footprint diamond; v2/placeholder art keeps the bottom-center anchor at natural size.
function applyBuildingArt(book: TextureBook, entry: Entry, art: BuildingArt, swapFrom: string | null): void {
  entry.url = art.url
  const p = swapFrom !== null && swapFrom !== art.url ? book.swap(swapFrom, art.url) : book.get(art.url)
  void p.then((t) => {
    if (entry.url !== art.url || entry.sprite.destroyed) return // superseded or torn down mid-load
    entry.sprite.texture = art.anchor !== null ? smoothSource(t) : t
    if (art.anchor !== null) entry.sprite.anchor.set(art.anchor.x, art.anchor.y)
    else entry.sprite.anchor.set(0.5, 1.0)
    entry.sprite.scale.set(art.scale ?? 1)
  })
}

function drawPips(g: Graphics, filled: number): void {
  g.clear()
  for (let i = 0; i < PIP_COUNT; i++) {
    g.rect(i * 6 - (PIP_COUNT * 6 - 2) / 2, 0, 4, 4)
    g.fill({ color: PIP_COLOR, alpha: i < filled ? 1 : 0.25 })
  }
}

async function provenanceText(structureId: string, state: WorldState | null): Promise<string> {
  const res = await fetch(`/api/structure/${structureId}/provenance`)
  if (!res.ok) return 'No one remembers who began this.'
  const p = (await res.json()) as { kind: string; plannedTick: number; builderId: string; completedTick: number | null }
  const begun = tickToMoment(p.plannedTick)
  const name = state?.agents[p.builderId]?.name ?? p.builderId
  const finish = p.completedTick === null ? 'still rising' : `finished Day ${tickToMoment(p.completedTick).day}`
  let text = `Begun by ${name} on Day ${begun.day} ${begun.time} — ${finish}`
  // the "why" line: the builder's journal entry nearest plannedTick, omitted when the journal is empty
  const jres = await fetch(`/api/agent/${p.builderId}/journal`)
  if (jres.ok) {
    const entries = (await jres.json()) as Array<{ tick: number; text: string }>
    const nearest = entries.reduce<{ tick: number; text: string } | null>(
      (best, e) => (best === null || Math.abs(e.tick - p.plannedTick) < Math.abs(best.tick - p.plannedTick) ? e : best),
      null,
    )
    if (nearest !== null) text += `\n"${nearest.text}"`
  }
  return text
}

let popEl: HTMLDivElement | null = null
function showPopover(text: string, x: number, y: number): void {
  if (popEl === null) {
    popEl = document.createElement('div')
    popEl.className = 'provenance-pop'
    document.body.appendChild(popEl)
    document.addEventListener('pointerdown', () => {
      if (popEl !== null) popEl.style.display = 'none'
    })
  }
  popEl.textContent = text
  popEl.style.display = 'block'
  popEl.style.left = `${Math.round(x)}px`
  popEl.style.top = `${Math.round(y)}px`
}

// lookup for effect layers (placement bounce, fire glow anchoring)
export function entitySpriteOf(scene: Scene, kind: 'structure' | 'item' | 'crop', id: string): Sprite | null {
  return syncStates.get(scene)?.entries.get(`${kind}:${id}`)?.sprite ?? null
}

// diff-based sync, called once per store change
export function syncEntities(scene: Scene, book: TextureBook, store: WorldStore): void {
  const state = store.getState()
  if (state === null) return
  let sync = syncStates.get(scene)
  if (sync === undefined) {
    sync = { entries: new Map(), lastAssetsSeq: store.assetsSeq() }
    syncStates.set(scene, sync)
  }
  const records = store.assetRecords()
  const live = new Set<string>()

  for (const s of Object.values(state.structures)) {
    const key = `structure:${s.id}`
    live.add(key)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0) // bottom-center pinned to the ground point (manifest law)
      sprite.eventMode = 'static'
      sprite.cursor = 'pointer'
      const sid = s.id
      sprite.on('pointertap', (e: FederatedPointerEvent) => {
        void provenanceText(sid, store.getState()).then((text) => showPopover(text, e.client.x, e.client.y))
      })
      entry = { sprite, url: '', pips: null }
      sync.entries.set(key, entry)
      scene.entities.addChild(sprite)
      applyBuildingArt(book, entry, buildingArt(records, s.kind, s.w, s.h), null)
    }
    const ground = tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.sprite.zIndex = depthKey(s.x + s.w - 1, s.y + s.h - 1)
    if (s.stage === 'construction') {
      entry.sprite.tint = CONSTRUCTION_TINT
      if (entry.pips === null) {
        entry.pips = new Graphics()
        entry.sprite.addChild(entry.pips)
      }
      // children inherit the sprite scale — counter-scale so pips stay screen-sized under hi-res downscale
      const k = entry.sprite.scale.x || 1
      entry.pips.scale.set(1 / k)
      entry.pips.position.set(0, 6 / k)
      drawPips(entry.pips, Math.min(PIP_COUNT, Math.floor((s.progressTicks / BUILD_TICKS_FULL) * PIP_COUNT)))
    } else {
      entry.sprite.tint = 0xffffff
      if (entry.pips !== null) {
        entry.pips.destroy()
        entry.pips = null
      }
    }
  }

  for (const it of Object.values(state.items)) {
    if (it.loc.t !== 'tile') continue
    const key = `item:${it.id}`
    live.add(key)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0)
      entry = { sprite, url: '', pips: null }
      sync.entries.set(key, entry)
      scene.entities.addChild(sprite)
      setTexture(book, entry, textureUrlFor(records, 'item', it.kind))
      void book.get(entry.url).then(() => {
        entry!.sprite.width = ITEM_PX
        entry!.sprite.height = ITEM_PX
      })
    }
    const ground = tileToScreen(it.loc.x, it.loc.y)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.sprite.zIndex = depthKey(it.loc.x, it.loc.y)
  }

  for (const c of Object.values(state.crops)) {
    const key = `crop:${c.id}`
    live.add(key)
    let entry = sync.entries.get(key)
    if (entry === undefined) {
      const sprite = new Sprite()
      sprite.anchor.set(0.5, 1.0)
      entry = { sprite, url: '', pips: null }
      sync.entries.set(key, entry)
      scene.entities.addChild(sprite)
      setTexture(book, entry, textureUrlFor(records, 'crop', c.kind))
    }
    const ground = tileToScreen(c.x, c.y)
    entry.sprite.position.set(ground.sx, ground.sy)
    entry.sprite.zIndex = depthKey(c.x, c.y)
    entry.sprite.scale.set(CROP_SCALE_BASE + CROP_SCALE_PER_STAGE * c.stage)
    entry.sprite.tint = c.withered ? WITHERED_TINT : 0xffffff
  }

  for (const [key, entry] of sync.entries) {
    if (!live.has(key)) {
      entry.sprite.destroy({ children: true })
      sync.entries.delete(key)
    }
  }

  // THE hot-load path — on new codex records, re-resolve every url and swap in place
  const seq = store.assetsSeq()
  if (seq !== sync.lastAssetsSeq) {
    sync.lastAssetsSeq = seq
    for (const [key, entry] of sync.entries) {
      const id = key.slice(key.indexOf(':') + 1)
      if (key.startsWith('structure:')) {
        const s = state.structures[id]
        if (s === undefined) continue
        const art = buildingArt(records, s.kind, s.w, s.h)
        if (art.url !== entry.url) applyBuildingArt(book, entry, art, entry.url)
        continue
      }
      const kind = key.startsWith('item:') ? state.items[id]?.kind : state.crops[id]?.kind
      if (kind === undefined) continue
      const url = textureUrlFor(records, key.startsWith('item:') ? 'item' : 'crop', kind)
      if (url !== entry.url) {
        const oldUrl = entry.url
        entry.url = url
        void book.swap(oldUrl, url).then((t) => {
          if (entry.url === url) entry.sprite.texture = t
        })
      }
    }
  }
}
