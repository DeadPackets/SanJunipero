// The stage is exactly three boxes, and every floating surface is placed INTO one of them, never
// across the boundary between two. `straddlers` is the mechanical proof.

export type Frame = { x: number; y: number; w: number; h: number }
export type FrameLayout = { picture: Frame; bandTop: Frame; bandBottom: Frame }

/** Each band, as a share of the stage. The cinema ratio the director view already used. */
export const LETTERBOX_FRACTION = 0.12

/**
 * On a 594px stage 12% is 71px and a postcard is 80, so the strip grew to hold one and the top band
 * did not — 71 against 88, visibly lopsided. The band has a floor, in the model and in the sheet.
 */
export const BAND_MIN_PX = 104

/**
 * The one geometry function. The three boxes partition the stage exactly — the picture takes
 * whatever the two bands leave, so no rounding can open a seam or a double-drawn row.
 */
export function frameLayout(stage: { w: number; h: number }, letterboxed: boolean): FrameLayout {
  const wanted = Math.max(Math.round(stage.h * LETTERBOX_FRACTION), BAND_MIN_PX)
  const band = letterboxed ? Math.min(wanted, Math.floor(stage.h / 2)) : 0
  return {
    bandTop: { x: 0, y: 0, w: stage.w, h: band },
    picture: { x: 0, y: band, w: stage.w, h: stage.h - 2 * band },
    bandBottom: { x: 0, y: stage.h - band, w: stage.w, h: band },
  }
}

/**
 * P19's guard: every box that CROSSES a band edge rather than sitting on one side of it. Touching
 * an edge is how a surface fills a band exactly, so only a strict crossing counts.
 */
export function straddlers(boxes: readonly ({ id: string } & Frame)[], l: FrameLayout): string[] {
  const edges = [l.picture.y, l.picture.y + l.picture.h].filter((_e, i) =>
    i === 0 ? l.bandTop.h > 0 : l.bandBottom.h > 0,
  )
  return boxes.filter((b) => edges.some((e) => b.y < e && b.y + b.h > e)).map((b) => b.id)
}

// ── the filmstrip ─────────────────────────────────────────────────────────────────────────

/** One postcard, and the gutter after it. A card is a press target, so it clears the floor. */
export const STRIP_CARD_W = 168
export const STRIP_GAP = 8

/**
 * Cards laid along the bottom band, scrolled so the open day is the one under your eyes. Pure: the
 * DOM half only applies the offsets, so the scroll position is testable without a layout engine.
 */
export function stripLayout(
  count: number,
  openIndex: number,
  bandW: number,
): { offsets: number[]; scrollX: number } {
  if (count <= 0) return { offsets: [], scrollX: 0 }
  const pitch = STRIP_CARD_W + STRIP_GAP
  const offsets = Array.from({ length: count }, (_, i) => i * pitch)
  const total = count * pitch - STRIP_GAP
  const max = Math.max(0, total - bandW)
  if (openIndex < 0 || openIndex >= count) return { offsets, scrollX: 0 }
  const wanted = offsets[openIndex]! + STRIP_CARD_W / 2 - bandW / 2
  return { offsets, scrollX: Math.min(max, Math.max(0, wanted)) }
}
