/**
 * Thirteen chips laid out permanently across the bonds lens is a card standing on the graph it
 * explains, so the key opens only when a viewer asks. The geometry lives beside the sheet it describes.
 */

export type Box = { x: number; y: number; w: number; h: number }
export type Stage = { w: number; h: number }

/** Every constant below is the value in `chrome.css`; a test walks the sheet and pins them. */
export const KEY_CHIP_H = 40 // .legend-chip min-height — a pointer target first
export const KEY_MAX_W = 640 // .society-key max-width: min(40rem, …)
export const KEY_GAP = 6.4 // 0.4rem
export const KEY_PAD_Y = 1.6 // 0.1rem
export const KEY_MARGIN = 12.8 // 0.8rem — the inset from the lens edge
export const KEY_BORDER = 10 // the 9-slice frame, on all four sides
export const KEY_SUMMARY_W = 168 // the shut control: one chip that says what it opens
export const KEY_AXIS_NAME_W = 110 // "HOW CLOSE" / "FAMILY" / "WHICH WAY"
export const KEY_AXES = 3

export function keyBox(stage: Stage, opts: { open: boolean; chips: number; chipW: number }): Box {
  const frame = 2 * KEY_BORDER
  const pad = 2 * KEY_PAD_Y
  if (!opts.open) {
    return {
      x: KEY_MARGIN,
      y: KEY_MARGIN,
      w: Math.min(KEY_SUMMARY_W + frame, stage.w - 2 * KEY_MARGIN),
      h: Math.min(KEY_CHIP_H + pad + frame, stage.h - 2 * KEY_MARGIN),
    }
  }
  const content = Math.max(KEY_CHIP_H, Math.min(KEY_MAX_W, stage.w - 2 * KEY_MARGIN - frame))
  const run = opts.chips * (opts.chipW + KEY_GAP) + KEY_AXES * KEY_AXIS_NAME_W
  const rows = Math.max(1, Math.ceil(run / content))
  return {
    x: KEY_MARGIN,
    y: KEY_MARGIN,
    w: Math.min(content + frame, stage.w - 2 * KEY_MARGIN),
    h: Math.min(rows * KEY_CHIP_H + (rows - 1) * KEY_GAP + pad + frame, stage.h - 2 * KEY_MARGIN),
  }
}

export function coverage(box: Box, stage: Stage): number {
  const area = stage.w * stage.h
  return area <= 0 ? 0 : (box.w * box.h) / area
}

/** Which people the key is standing on. Inclusive on the near edges, like a hit box. */
export function nodesUnder(
  nodes: readonly { id: string; x: number; y: number }[],
  box: Box,
): string[] {
  return nodes
    .filter((n) => n.x >= box.x && n.x <= box.x + box.w && n.y >= box.y && n.y <= box.y + box.h)
    .map((n) => n.id)
}
