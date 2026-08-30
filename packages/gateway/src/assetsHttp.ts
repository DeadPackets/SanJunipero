import type { ServerResponse } from 'node:http'
import type { AssetClass } from '@sj/shared'
import {
  AssetCodex,
  EMOTE_KINDS,
  EMOTE_SIZE,
  FACINGS,
  POSES_V2,
  CELL_V2,
  FEET_Y_V2,
  SHEET_W_V2,
  SHEET_H_V2,
  encodePng,
  makePlaceholder,
  paletteRgb,
  renderEmote,
  type Facing,
  type RawImage,
  type Rgb,
} from '@sj/forge'
import type { Router } from './router.js'
import { notFound, sendJson } from './http.js'
import { reportOnce } from './degraded.js'

export const PLACEHOLDER_PX: Record<AssetClass, { w: number; h: number }> = {
  building: { w: 64, h: 64 },
  item: { w: 24, h: 24 },
  crop: { w: 32, h: 32 },
  terrain: { w: 32, h: 16 },
  'rig-part': { w: 96, h: 96 },
  portrait: { w: 128, h: 128 },
}

// Placeholder-sheet geometry (Character standard v2 cells; tunables exported per plan law)
const BODY_W = 40
const BODY_H = 64
const FOOT_BAR_W = 4
const FOOT_BAR_H = 2
const FOOT_BAR_Y = 86
const FOOT_BAR_OFFSET = 6
const MARKER_SIZE = 6
// facing corner markers: sw honey, se sage, ne water, nw rose (master-palette ramp entries)
const FACING_MARKER: Record<Facing, Rgb> = {
  sw: [0xe0, 0xa9, 0x5e],
  se: [0x93, 0xb5, 0x73],
  ne: [0x7f, 0xb0, 0xc9],
  nw: [0xe0, 0x9e, 0x9b],
}

const px = (img: RawImage, x: number, y: number, c: Rgb): void => {
  img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}

// v2 geometry: 4 facing cols × 6 pose rows, 96×96 cells, feet at y=88; walk poses visibly
// distinct via foot-bar offsets; sleep lies sideways (wider than tall).
function buildPlaceholderSheet(agentId: string): RawImage {
  const pal = paletteRgb()
  // body fill alternates two warm-grey ramp entries chosen by agentId char-code sum parity
  const parity = Array.from(agentId).reduce((s, ch) => s + ch.charCodeAt(0), 0) % 2
  const light = parity === 0 ? pal[24]! : pal[25]!
  const dark = parity === 0 ? pal[25]! : pal[26]!
  const barColor = pal[31]!
  const sheet: RawImage = {
    width: SHEET_W_V2,
    height: SHEET_H_V2,
    data: new Uint8ClampedArray(SHEET_W_V2 * SHEET_H_V2 * 4),
  }

  FACINGS.forEach((facing, col) => {
    POSES_V2.forEach((pose, row) => {
      const cx = col * CELL_V2,
        cy = row * CELL_V2
      const lying = pose === 'sleep'
      const rw = lying ? BODY_H : BODY_W,
        rh = lying ? BODY_W : BODY_H
      const rx = (CELL_V2 - rw) >> 1,
        ry = FEET_Y_V2 - rh
      // makePlaceholder checkerboard cropped to the body rect (cell-local coords keep it deterministic)
      for (let y = ry; y < ry + rh; y++)
        for (let x = rx; x < rx + rw; x++) {
          px(sheet, cx + x, cy + y, ((x >> 2) + (y >> 2)) % 2 === 0 ? light : dark)
        }
      // per-pose foot bar: contact-a left, contact-b right, passing centered; idle/sleep none
      const off =
        pose === 'contact-a'
          ? -FOOT_BAR_OFFSET
          : pose === 'contact-b'
            ? FOOT_BAR_OFFSET
            : pose === 'passing-a' || pose === 'passing-b'
              ? 0
              : null
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

function buildEmoteAtlas(): RawImage {
  const width = EMOTE_KINDS.length * EMOTE_SIZE
  const atlas: RawImage = {
    width,
    height: EMOTE_SIZE,
    data: new Uint8ClampedArray(width * EMOTE_SIZE * 4),
  }
  EMOTE_KINDS.forEach((kind, i) => {
    const glyph = renderEmote(kind)
    for (let y = 0; y < EMOTE_SIZE; y++)
      atlas.data.set(
        glyph.data.subarray(y * EMOTE_SIZE * 4, (y + 1) * EMOTE_SIZE * 4),
        (y * width + i * EMOTE_SIZE) * 4,
      )
  })
  return atlas
}

/** A codex row holds the shipped art as lossless WebP or this process's own PNG, so the container
 *  is read off the bytes — the `.png` in the URL is a suffix on an id, not a promise. */
const contentType = (buf: Buffer): string =>
  buf.length >= 12 && buf.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : 'image/png'

const sendImage = (res: ServerResponse, buf: Buffer, immutable = false): void => {
  const headers: Record<string, string> = { 'content-type': contentType(buf) }
  if (immutable) headers['cache-control'] = 'public, max-age=31536000, immutable'
  res.writeHead(200, headers)
  res.end(buf)
}

const stripPng = (file: string): string | null => (file.endsWith('.png') ? file.slice(0, -4) : null)

/** Encoded sheets held at once. A character sheet is 5 938 B here, so this is about 760 KB. */
const MAX_ENCODED = 128

/**
 * The key is the stranger's to choose and `sharp` runs on libuv's four-thread pool, which the
 * whole process shares with every file read. Two guards: the id must name somebody the world
 * actually has, and each sheet is encoded once.
 */
export type AssetRouteDeps = {
  getCodex(): AssetCodex | null
  /** Absent → every id is served, which is only ever right for a test fixture. */
  knowsAgent?: (id: string) => boolean
}

/** One zod parse per row for the process, not one per image GET; the cursor tops up from the
 *  codex's own seq at read time. Shared, so the stage and a share card cannot disagree. */
export function makeNewestReady(): (codex: AssetCodex, kind: string) => string | undefined {
  let seq = 0
  const byKind = new Map<string, string>()
  return (codex, kind) => {
    for (const r of codex.listSince(seq)) {
      seq = r.seq
      if (r.status === 'ready' && r.kind !== null) byKind.set(r.kind, r.id)
    }
    return byKind.get(kind)
  }
}

export function mountAssetRoutes(router: Router, deps: AssetRouteDeps): void {
  const newestReady = makeNewestReady()

  // The PROMISE is held, not the buffer: N concurrent misses on one key would otherwise run N
  // sharp encodes on libuv's four threads. Oldest-first past the cap — `fold.ts` leaves the dead
  // in `state.agents` for ever and `knowsAgent` lets them all through.
  const encoded = new Map<string, Promise<Buffer>>()
  const onceEncoded = (
    res: ServerResponse,
    key: string,
    build: () => RawImage,
    then: (buf: Buffer) => void,
  ): void => {
    // A failed encode must not be remembered as this key's answer for the life of the process,
    // and an unanswered request holds the socket until Node's 300 s timeout.
    const failed = (e: unknown): void => {
      encoded.delete(key)
      reportOnce(
        `encode.${key.split(':')[0]}`,
        () => `could not encode ${key} — ${e instanceof Error ? e.message : String(e)}`,
      )
      if (!res.headersSent) sendJson(res, { error: 'could not draw that' }, 500)
    }
    let p = encoded.get(key)
    if (p === undefined) {
      try {
        p = encodePng(build())
      } catch (e) {
        failed(e)
        return
      }
      if (encoded.size >= MAX_ENCODED) encoded.delete(encoded.keys().next().value!)
      encoded.set(key, p)
    }
    void p.then(then, failed)
  }

  router.route('GET', '/assets/placeholder/:file', (_req, res, params) => {
    const klass = stripPng(params.file ?? '')
    const size =
      klass !== null && klass in PLACEHOLDER_PX ? PLACEHOLDER_PX[klass as AssetClass] : undefined
    if (!size) {
      notFound(res)
      return
    }
    onceEncoded(
      res,
      `placeholder:${klass}`,
      () => makePlaceholder(klass as AssetClass, size),
      (buf) => {
        sendImage(res, buf)
      },
    )
  })

  router.route('GET', '/assets/character/:file', (_req, res, params) => {
    const agentId = stripPng(params.file ?? '')
    if (agentId === null || agentId === '') {
      notFound(res)
      return
    }
    if (deps.knowsAgent !== undefined && !deps.knowsAgent(agentId)) {
      notFound(res)
      return
    }
    // binding: newest ready codex sheet registered for this agent, else the built placeholder
    const codex = deps.getCodex()
    if (codex) {
      const id = newestReady(codex, `character:${agentId}`)
      const hit = id === undefined ? null : codex.get(id)
      if (hit) {
        sendImage(res, hit.png)
        return
      }
    }
    onceEncoded(
      res,
      `character:${agentId}`,
      () => buildPlaceholderSheet(agentId),
      (buf) => {
        sendImage(res, buf)
      },
    )
  })

  router.route('GET', '/assets/:file', (_req, res, params) => {
    const file = params.file ?? ''
    if (file === 'emotes.png') {
      onceEncoded(res, 'emotes', buildEmoteAtlas, (buf) => {
        sendImage(res, buf)
      })
      return
    }
    if (file === 'emotes.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ size: EMOTE_SIZE, order: EMOTE_KINDS }))
      return
    }
    const id = stripPng(file)
    const hit = id !== null ? (deps.getCodex()?.get(id) ?? null) : null
    if (!hit) {
      notFound(res)
      return
    }
    sendImage(res, hit.png, true) // codex rows never mutate; replacements get new ids
  })
}
