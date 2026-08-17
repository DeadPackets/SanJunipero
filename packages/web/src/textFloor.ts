// LEGIBILITY FLOORS. Partial C12 Task 53 — the floors only; the coherent six-step scale is
// still C12's. One number per floor, in one place, so a new call site cannot quietly
// reintroduce 8px text the way seventeen ad-hoc sizes did.

/** Nothing in the product renders a glyph below this, in CSS pixels. */
export const TEXT_MIN_PX = 12

/** Prose — sentences a viewer reads, as opposed to chips, stamps and counts — starts here. */
export const BODY_MIN_PX = 14

/** World-space text. World scale is 1 at ZOOM_MIN, so a world px IS a CSS px on arrival. */
export const WORLD_TEXT_PX = TEXT_MIN_PX
export const WORLD_TEXT_LINE_H = 14
