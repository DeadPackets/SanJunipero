import sharp from 'sharp'
import { parseCharacterAtlasManifest } from '@sj/shared'
import type { AssetCodex } from '@sj/forge'
import { makeNewestReady } from './assetsHttp.js'
import { attr } from './http.js'

/** `@sj/narrator`'s `renderShareCard` draws the same box, and `og:image:width/height` claims it. */
export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 565

const SPRITE_CELL = 'idle-se'
const PAD = 72
const GAP = 60
const SPRITE_BOX = 288

export type AgentRead = { id: string; name: string; line: string | null }

/** A sheet with no v4 manifest — the built placeholder — is deliberately not offered: a card is
 *  a face or it is type, never a test pattern. */
export function makeSpriteReader(
  getCodex: () => AssetCodex | null,
): (agentId: string) => Promise<string | null> {
  const newestReady = makeNewestReady()
  // Keyed by ASSET id, which a regenerated sheet never reuses — so this is a memo, not a cache.
  // Without it every card GET re-reads a 748 KB blob and spends 10 ms of the pool re-cropping it.
  const cut = new Map<string, Promise<string>>()

  return async (agentId) => {
    const codex = getCodex()
    if (codex === null) return null
    const id = newestReady(codex, `character:${agentId}`)
    if (id === undefined) return null
    let uri = cut.get(id)
    if (uri === undefined) {
      const sheet = codex.get(id)
      const cell = parseCharacterAtlasManifest(sheet?.record.meta ?? null)?.cells[SPRITE_CELL]
      if (sheet === null || cell === undefined) return null
      uri = sharp(sheet.png)
        .extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h })
        .png()
        .toBuffer()
        .then((png) => `data:image/png;base64,${png.toString('base64')}`)
      cut.set(id, uri)
    }
    return uri
  }
}

export function renderAgentCard(read: AgentRead, sprite: string | null, town: string): string {
  const textX = sprite === null ? PAD : PAD + SPRITE_BOX + GAP
  const text = (y: number, size: number, fill: string, s: string): string =>
    `<text x="${textX}" y="${y}" font-family="Georgia, serif" font-size="${size}" fill="${fill}">${attr(s)}</text>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">` +
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#f6e7d7"/>` +
    `<rect x="0" y="0" width="${CARD_WIDTH}" height="8" fill="#d97742"/>` +
    (sprite === null
      ? ''
      : `<rect x="${PAD}" y="140" width="${SPRITE_BOX}" height="${SPRITE_BOX}" rx="16" fill="#e9d4bd"/>` +
        `<image href="${sprite}" x="${PAD}" y="140" width="${SPRITE_BOX}" height="${SPRITE_BOX}" image-rendering="pixelated"/>`) +
    text(110, 34, '#8a6a4f', town) +
    `<text x="${textX}" y="290" font-family="Georgia, serif" font-size="64" font-weight="bold" fill="#4a3222">${attr(read.name)}</text>` +
    (read.line === null ? '' : text(350, 32, '#6b503a', read.line)) +
    `</svg>`
  )
}
