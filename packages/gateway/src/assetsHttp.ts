import type { ServerResponse } from 'node:http'
import type { AssetClass } from '@sj/shared'
import {
  AssetCodex, EMOTE_KINDS, EMOTE_SIZE, FACINGS, POSES_V2, CELL_V2, FEET_Y_V2, SHEET_W_V2, SHEET_H_V2,
  encodePng, makePlaceholder, paletteRgb, renderEmote, type Facing, type RawImage, type Rgb,
} from '@sj/forge'
import type { Router } from './server.js'

export const PLACEHOLDER_PX: Record<AssetClass, { w: number; h: number }> = {
  building: { w: 64, h: 64 }, item: { w: 24, h: 24 }, crop: { w: 32, h: 32 },
  terrain: { w: 32, h: 16 }, 'rig-part': { w: 96, h: 96 }, portrait: { w: 128, h: 128 },
}

// Placeholder-sheet geometry (Character standard v2 cells; tunables exported per plan law)
export const BODY_W = 40
export const BODY_H = 64
export const FOOT_BAR_W = 4
export const FOOT_BAR_H = 2
export const FOOT_BAR_Y = 86
export const FOOT_BAR_OFFSET = 6
export const MARKER_SIZE = 6
// facing corner markers: sw honey, se sage, ne water, nw rose (master-palette ramp entries)
export const FACING_MARKER: Record<Facing, Rgb> = {
  sw: [0xe0, 0xa9, 0x5e], se: [0x93, 0xb5, 0x73], ne: [0x7f, 0xb0, 0xc9], nw: [0xe0, 0x9e, 0x9b],
}

const px = (img: RawImage, x: number, y: number, c: Rgb): void => {
  img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}

// v2 geometry: 4 facing cols × 6 pose rows, 96×96 cells, feet at y=88; walk poses visibly
// distinct via foot-bar offsets; sleep lies sideways (wider than tall).
export function buildPlaceholderSheet(agentId: string): RawImage {
  const pal = paletteRgb()
  // body fill alternates two warm-grey ramp entries chosen by agentId char-code sum parity
  const parity = [...agentId].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 2
  const light = parity === 0 ? pal[24]! : pal[25]!
  const dark = parity === 0 ? pal[25]! : pal[26]!
  const barColor = pal[31]!
  const sheet: RawImage = { width: SHEET_W_V2, height: SHEET_H_V2, data: new Uint8ClampedArray(SHEET_W_V2 * SHEET_H_V2 * 4) }

  FACINGS.forEach((facing, col) => {
    POSES_V2.forEach((pose, row) => {
      const cx = col * CELL_V2, cy = row * CELL_V2
      const lying = pose === 'sleep'
      const rw = lying ? BODY_H : BODY_W, rh = lying ? BODY_W : BODY_H
      const rx = (CELL_V2 - rw) >> 1, ry = FEET_Y_V2 - rh
      // makePlaceholder checkerboard cropped to the body rect (cell-local coords keep it deterministic)
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
        px(sheet, cx + x, cy + y, ((x >> 2) + (y >> 2)) % 2 === 0 ? light : dark)
      }
      // per-pose foot bar: contact-a left, contact-b right, passing centered; idle/sleep none
      const off = pose === 'contact-a' ? -FOOT_BAR_OFFSET : pose === 'contact-b' ? FOOT_BAR_OFFSET
        : pose === 'passing-a' || pose === 'passing-b' ? 0 : null
      if (off !== null) {
        const bx = (CELL_V2 >> 1) + off - (FOOT_BAR_W >> 1)
        for (let y = FOOT_BAR_Y; y < FOOT_BAR_Y + FOOT_BAR_H; y++)
          for (let x = bx; x < bx + FOOT_BAR_W; x++) px(sheet, cx + x, cy + y, barColor)
      }
      // facing marker inside the body rect's top-left corner (kept inside so sleep bbox stays lying)
      const mk = FACING_MARKER[facing]
      for (let y = ry; y < ry + MARKER_SIZE; y++)
        for (let x = rx; x < rx + MARKER_SIZE; x++) px(sheet, cx + x, cy + y, mk)
    })
  })
  return sheet
}

export function buildEmoteAtlas(): RawImage {
  const width = EMOTE_KINDS.length * EMOTE_SIZE
  const atlas: RawImage = { width, height: EMOTE_SIZE, data: new Uint8ClampedArray(width * EMOTE_SIZE * 4) }
  EMOTE_KINDS.forEach((kind, i) => {
    const glyph = renderEmote(kind)
    for (let y = 0; y < EMOTE_SIZE; y++)
      atlas.data.set(glyph.data.subarray(y * EMOTE_SIZE * 4, (y + 1) * EMOTE_SIZE * 4), (y * width + i * EMOTE_SIZE) * 4)
  })
  return atlas
}

const notFound = (res: ServerResponse): void => {
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{"error":"not found"}')
}

const sendPng = (res: ServerResponse, buf: Buffer, immutable = false): void => {
  const headers: Record<string, string> = { 'content-type': 'image/png' }
  if (immutable) headers['cache-control'] = 'public, max-age=31536000, immutable'
  res.writeHead(200, headers)
  res.end(buf)
}

const stripPng = (file: string): string | null => (file.endsWith('.png') ? file.slice(0, -4) : null)

/**
 * ★ THE PLACEHOLDER ROUTES ENCODE A PNG PER REQUEST, AND THE KEY IS THE STRANGER'S TO CHOOSE.
 *
 * `/assets/character/<anything>.png` built and `sharp`-encoded a fresh 384×576 sheet for any id
 * asked for, real agent or not. sharp runs on libuv's four-thread pool, which the whole process
 * shares with every file read, so a stranger looping over made-up ids starves the server of
 * threads with a handful of GETs. Two guards, and neither costs a real viewer anything:
 * the id must name somebody the world actually has, and each sheet is encoded once.
 */
export type AssetRouteDeps = {
  getCodex(): AssetCodex | null
  /** Absent → every id is served, which is only ever right for a test fixture. */
  knowsAgent?: (id: string) => boolean
}

export function mountAssetRoutes(router: Router, deps: AssetRouteDeps): void {
  const encoded = new Map<string, Buffer>()
  const onceEncoded = (key: string, build: () => RawImage, then: (buf: Buffer) => void): void => {
    const hit = encoded.get(key)
    if (hit !== undefined) { then(hit); return }
    void encodePng(build()).then((buf) => { encoded.set(key, buf); then(buf) })
  }

  router.route('GET', '/assets/placeholder/:file', (_req, res, params) => {
    const klass = stripPng(params.file ?? '')
    const size = klass !== null && klass in PLACEHOLDER_PX ? PLACEHOLDER_PX[klass as AssetClass] : undefined
    if (!size) { notFound(res); return }
    onceEncoded(`placeholder:${klass}`, () => makePlaceholder(klass as AssetClass, size),
      (buf) => sendPng(res, buf))
  })

  router.route('GET', '/assets/character/:file', (_req, res, params) => {
    const agentId = stripPng(params.file ?? '')
    if (agentId === null || agentId === '') { notFound(res); return }
    if (deps.knowsAgent !== undefined && !deps.knowsAgent(agentId)) { notFound(res); return }
    // binding: newest ready codex sheet registered for this agent, else the built placeholder
    const codex = deps.getCodex()
    if (codex) {
      const match = codex.listSince(0)
        .filter(r => r.status === 'ready' && r.kind === `character:${agentId}`)
        .at(-1)
      if (match) {
        const hit = codex.get(match.id)
        if (hit) { sendPng(res, hit.png); return }
      }
    }
    onceEncoded(`character:${agentId}`, () => buildPlaceholderSheet(agentId), (buf) => sendPng(res, buf))
  })

  router.route('GET', '/assets/:file', (_req, res, params) => {
    const file = params.file ?? ''
    if (file === 'emotes.png') {
      onceEncoded('emotes', buildEmoteAtlas, (buf) => sendPng(res, buf))
      return
    }
    if (file === 'emotes.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ size: EMOTE_SIZE, order: EMOTE_KINDS }))
      return
    }
    const id = stripPng(file)
    const hit = id !== null ? deps.getCodex()?.get(id) ?? null : null
    if (!hit) { notFound(res); return }
    sendPng(res, hit.png, true) // codex rows never mutate; replacements get new ids
  })
}
