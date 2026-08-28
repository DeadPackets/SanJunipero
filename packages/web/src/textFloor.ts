// One number per floor, in one place, so a call site cannot quietly reintroduce 8px text.

/** Nothing in the product renders a glyph below this, in CSS pixels. */
export const TEXT_MIN_PX = 12

/** Prose — sentences a viewer reads, as opposed to chips, stamps and counts — starts here. */
export const BODY_MIN_PX = 14

/** World-space text. World scale is 1 at ZOOM_MIN, so a world px IS a CSS px on arrival, and
 *  the floor is the same one — `TEXT_MIN_PX`. */
export const WORLD_TEXT_LINE_H = 14
