// STATUS AND MOOD ICONS AT THE C-LEVEL BAR.
//
// Another lane found the roster's mood glyph drawing ONE art pixel per screen pixel, so a
// required status icon renders as a smudge, and told the panels lane not to compensate by
// smoothing. This is the forge's half of that: the icon class gets a source at the density it
// is displayed at, so nobody has to smooth anything.
//
// The defect measured here: `renderEmote` authors a 16x16 glyph and characters.ts draws it at
// EMOTE_PX = 16 world px. That is 1 art px per world px, while the figure beside it now
// carries 208 art px over 52 — four times denser. At the 4x zoom stop the character is 1:1 and
// the icon is a 16 px glyph stretched over 64.
//
// The design itself is authored on a 16 grid and has no more shape to give, so the delivery is
// the SAME art on a whole 4 px lattice: an exact integer upscale, no filter, no invented
// colour, and `pixelGridGate(icon, 4)` proves it. Consumers draw it 1:1 at the deep stop and
// divide by 4 at the shallow one — both exact.
//
// This is ADDITIVE. EMOTE_SIZE and the gateway's /assets/emotes atlas do not move, because
// characters.ts slices that atlas at EMOTE_PX and packages/web/src is out of this lane's
// scope. The panels lane consumes `statusIconAtlas()`.
import { EMOTE_KINDS, EMOTE_SIZE, renderEmote, type EmoteKind } from './emotes.js'
import type { RawImage } from './post/raw.js'
import { upscaleNearest } from './sheet.js'

// what the renderer gives a glyph on the ground, in world pixels (characters.ts EMOTE_PX)
export const STATUS_ICON_WORLD_PX = 16
// the deepest zoom stop, which is also the character class's art px per world px
export const STATUS_ICON_SCALE = 4
export const STATUS_ICON_PX = EMOTE_SIZE * STATUS_ICON_SCALE

export function statusIcon(kind: EmoteKind): RawImage {
  return upscaleNearest(renderEmote(kind), STATUS_ICON_SCALE)
}

/** One row, in EMOTE_KINDS order — the same layout the 16 px atlas uses, four times over. */
export function statusIconAtlas(): RawImage {
  const width = EMOTE_KINDS.length * STATUS_ICON_PX
  const atlas: RawImage = {
    width, height: STATUS_ICON_PX, data: new Uint8ClampedArray(width * STATUS_ICON_PX * 4),
  }
  EMOTE_KINDS.forEach((kind, i) => {
    const g = statusIcon(kind)
    for (let y = 0; y < STATUS_ICON_PX; y++) {
      atlas.data.set(g.data.subarray(y * STATUS_ICON_PX * 4, (y + 1) * STATUS_ICON_PX * 4),
        (y * width + i * STATUS_ICON_PX) * 4)
    }
  })
  return atlas
}
