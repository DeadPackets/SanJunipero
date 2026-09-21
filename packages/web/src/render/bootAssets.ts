import { parseMaterialSetManifest, type AssetRecord } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { firstFrameProgress, firstFrameRetry } from '../ui/firstFrame.js'
import { characterArt, openBoot, TextureBook } from './textures.js'
import flatIcons from '../paper/game/assets/flat-icons.png'
import weatherIcons from '../paper/game/assets/weather-icons.png'
import controlIcons from '../stage/assets/control-icons.png'

export function bootAssetUrls(records: AssetRecord[], residents: readonly string[]): string[] {
  const latest = new Map<string, AssetRecord>()
  for (const record of records) {
    if (record.status !== 'ready' || !record.kind) continue
    if (record.kind.startsWith('character:') && !residents.includes(record.kind.slice(10))) continue
    const key = `${record.class}:${record.kind}`
    if ((latest.get(key)?.seq ?? -1) < record.seq) latest.set(key, record)
  }
  const urls = new Set<string>([
    '/assets/emotes.png',
    '/assets/placeholder/item.png',
    flatIcons,
    weatherIcons,
    controlIcons,
  ])
  for (const record of latest.values()) {
    urls.add(`/assets/${record.id}.png`)
    const manifest = parseMaterialSetManifest(record.meta)
    for (const map of Object.values(manifest?.maps ?? {}))
      if (map) urls.add(`/assets/${map.assetId}.png`)
  }
  for (const id of residents) urls.add(characterArt(records, id).url)
  return [...urls]
}

export async function loadBootAssets(
  urls: readonly string[],
  load: (url: string) => Promise<unknown>,
  progress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<string[]> {
  let next = 0
  let loaded = 0
  const failures: string[] = []
  progress(0, urls.length)
  await Promise.all(
    Array.from({ length: Math.min(6, urls.length) }, async () => {
      while (next < urls.length) {
        signal.throwIfAborted()
        const url = urls[next++]!
        try {
          await load(url)
        } catch {
          failures.push(url)
        }
        signal.throwIfAborted()
        progress(++loaded, urls.length)
      }
    }),
  )
  return failures
}

export async function prepareTownAssets(store: WorldStore, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      off()
      reject(new DOMException('Loading cancelled', 'AbortError'))
    }
    const check = () => {
      if (!store.getState() || !store.assetsReady()) return
      off()
      signal.removeEventListener('abort', abort)
      resolve()
    }
    const off = store.subscribe(check)
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
  signal.throwIfAborted()
  const records = store.assetRecords()
  openBoot(records)
  const urls = bootAssetUrls(records, Object.keys(store.getState()!.agents))
  const book = new TextureBook()
  const fonts = [
    '400 16px "Press Start 2P"',
    '400 16px Silkscreen',
    '700 16px Silkscreen',
    '500 16px Fraunces',
    '700 16px Fraunces',
    '400 16px Manrope',
    '600 16px Manrope',
  ]
  let pending = [...urls, ...fonts.map((font) => `font:${font}`)]
  do {
    pending = await loadBootAssets(
      pending,
      (url) => (url.startsWith('font:') ? document.fonts.load(url.slice(5)) : book.get(url)),
      firstFrameProgress,
      signal,
    )
    if (pending.length > 0) await firstFrameRetry(pending.length, signal)
  } while (pending.length > 0)
  signal.throwIfAborted()
}
