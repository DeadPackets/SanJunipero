import type { ZoomStop } from '../render/camera.js'
import { ZOOM_STOPS, stepStop } from '../render/camera.js'
import { LENSES, type Lens } from './route.js'

// The bar's contents are DERIVED from what the viewer can currently do, so it can never advertise
// a control that does nothing, and a refusal is SHOWN rather than merely implied.

export const CONTROL_GROUPS = ['time', 'camera', 'lens', 'view'] as const
export type ControlGroup = (typeof CONTROL_GROUPS)[number]

export type ControlItem = {
  id: string
  group: ControlGroup
  /** the spoken label; also the tooltip */
  label: string
  /** an 8×8 pixel glyph id — NEVER an emoji (P3, the landed law) */
  glyph: string
  /** a toggle renders aria-pressed; absent = an action */
  state?: 'on' | 'off'
  disabled?: boolean
  /** shown, not merely implied — an honest refusal */
  disabledReason?: string
}

export type ControlCtx = {
  lens: Lens
  live: boolean
  zoom: ZoomStop
  following: string | null
  insideId: string | null
  hudHidden: boolean
  /** Does the whole settlement fit on the stage at the widest stop? The ladder ends at 0.25 and
   *  the town grows without bound, so the overview control says what it will actually do. */
  townFits: boolean
}

/** The town's own word for each lens, so the bar and the top nav name one thing once. */
export const LENS_LABEL: Readonly<Record<Lens, string>> = {
  map: 'The town', inspector: 'Townsfolk', chronicle: 'Chronicle', discoveries: 'What they made',
  society: 'Bonds', director: 'Moments', laws: 'World laws',
}
export const LENS_GLYPH: Readonly<Record<Lens, string>> = {
  map: 'tile', inspector: 'folk', chronicle: 'scroll', discoveries: 'find',
  society: 'bond', director: 'reel', laws: 'book',
}

export function controlItems(ctx: ControlCtx): ControlItem[] {
  const out: ControlItem[] = [{
    id: 'live',
    group: 'time',
    label: ctx.live ? 'Watching now' : 'Back to now',
    glyph: 'now',
    state: ctx.live ? 'on' : 'off',
  }]

  const atMin = ctx.zoom <= ZOOM_STOPS[0]
  const atMax = ctx.zoom >= ZOOM_STOPS[ZOOM_STOPS.length - 1]!
  out.push({
    id: 'zoom-out',
    group: 'camera',
    label: 'Further away',
    glyph: 'out',
    ...(atMin ? { disabled: true, disabledReason: 'This is as wide as the camera goes.' } : {}),
  })
  out.push({
    id: 'zoom-in',
    group: 'camera',
    label: 'Closer in',
    glyph: 'in',
    ...(atMax ? { disabled: true, disabledReason: 'This is as close as the camera goes.' } : {}),
  })
  out.push({
    id: 'fit',
    group: 'camera',
    // Not disabled: it still does the most useful thing it can. It just stops over-promising.
    label: ctx.townFits ? 'The whole town' : 'As much of the town as fits',
    glyph: 'fit',
  })
  if (ctx.following !== null) {
    out.push({ id: 'unfollow', group: 'camera', label: 'Stop following', glyph: 'eye' })
  }
  if (ctx.insideId !== null) {
    out.push({ id: 'exit-interior', group: 'camera', label: 'Back to town', glyph: 'door' })
  }

  for (const lens of LENSES) {
    out.push({
      id: `lens-${lens}`,
      group: 'lens',
      label: LENS_LABEL[lens],
      glyph: LENS_GLYPH[lens],
      state: ctx.lens === lens ? 'on' : 'off',
    })
  }

  out.push({
    id: 'hud',
    group: 'view',
    label: ctx.hudHidden ? 'Show the controls' : 'Hide the controls',
    glyph: 'hud',
    // pressed means PUT AWAY. Lit while the bar is on screen read as "hide is on", which is
    // the opposite of what the button was offering.
    state: ctx.hudHidden ? 'on' : 'off',
  })
  return out
}

export type ControlAction =
  | { kind: 'lens'; lens: Lens }
  | { kind: 'zoom'; dir: 1 | -1 }
  | { kind: 'fit' }
  | { kind: 'live' }
  | { kind: 'follow'; agentId: string | null }
  | { kind: 'exit-interior' }
  | { kind: 'hud'; op: 'hide' | 'show' }

/** TOTAL over every id `controlItems` can produce. A bar that can render a button it cannot
 *  answer is a bar with a dead button in it. */
export function actionFor(item: ControlItem): ControlAction {
  if (item.id.startsWith('lens-')) {
    return { kind: 'lens', lens: item.id.slice('lens-'.length) as Lens }
  }
  switch (item.id) {
    case 'live': return { kind: 'live' }
    case 'zoom-out': return { kind: 'zoom', dir: -1 }
    case 'zoom-in': return { kind: 'zoom', dir: 1 }
    case 'fit': return { kind: 'fit' }
    case 'unfollow': return { kind: 'follow', agentId: null }
    case 'exit-interior': return { kind: 'exit-interior' }
    case 'hud': return { kind: 'hud', op: item.state === 'on' ? 'show' : 'hide' }
    default: return { kind: 'fit' }
  }
}

/** Where a zoom action lands, given where the camera is. One rule for the bar, the keyboard
 *  and the wheel alike. */
export const zoomTargetOf = (from: ZoomStop, dir: 1 | -1): ZoomStop => stepStop(from, dir)

export const CONTROL_BAR_H = 56

// ── the glyphs: 8×8 palette pixels, never a character from the reader's font (P3) ────────

const INK = '#43394A', HONEY = '#F2C879', SAND = '#E8D5BC', WATER = '#7FB0C9'
const SAGE = '#93B573', ROSE = '#C47876', EMBER = '#E8785A'

/** Every fill a control glyph may use — all MASTER_PALETTE members, asserted as a set. */
export const CONTROL_GLYPH_PALETTE: readonly string[] = [INK, HONEY, SAND, WATER, SAGE, ROSE, EMBER]

const KEY: Readonly<Record<string, string>> = {
  i: INK, h: HONEY, s: SAND, w: WATER, g: SAGE, r: ROSE, e: EMBER,
}

export const CONTROL_GLYPH_PX = 8

export type GlyphPixel = readonly [number, number, string]

/** Eight rows of eight characters: `.` is empty, every other letter is a palette key. Written
 *  as pictures because a table of coordinates is a picture nobody can read. */
function art(...rows: string[]): GlyphPixel[] {
  const out: GlyphPixel[] = []
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = KEY[ch]
      if (fill !== undefined) out.push([x, y, fill] as const)
    })
  })
  return out
}

export const CONTROL_GLYPH: Readonly<Record<string, GlyphPixel[]>> = {
  now: art(
    '..iiii..',
    '.i....i.',
    'i..i...i',
    'i..i...i',
    'i..iii.i',
    'i......i',
    '.i....i.',
    '..iiii..',
  ),
  out: art(
    '........',
    '........',
    '........',
    'iiiiiiii',
    'iiiiiiii',
    '........',
    '........',
    '........',
  ),
  in: art(
    '...ii...',
    '...ii...',
    '...ii...',
    'iiiiiiii',
    'iiiiiiii',
    '...ii...',
    '...ii...',
    '...ii...',
  ),
  fit: art(
    'ii.ii.ii',
    'i......i',
    '........',
    '..gggg..',
    '..gggg..',
    'i......i',
    'i......i',
    'ii.ii.ii',
  ),
  eye: art(
    '........',
    '..iiii..',
    '.i....i.',
    'i..ww..i',
    'i..ww..i',
    '.i....i.',
    '..iiii..',
    '........',
  ),
  door: art(
    '.iiiiii.',
    '.issssi.',
    '.issssi.',
    '.isssshi',
    '.issssi.',
    '.issssi.',
    '.issssi.',
    '.iiiiii.',
  ),
  hud: art(
    'iiiiiiii',
    '........',
    'iiiiiiii',
    '........',
    'iiiiiiii',
    '........',
    'hhhhhhhh',
    '........',
  ),
  tile: art(
    '........',
    '...ii...',
    '..igggi.',
    '.igggggi',
    '.igggggi',
    '..igggi.',
    '...ii...',
    '........',
  ),
  folk: art(
    '..ii.ii.',
    '..ii.ii.',
    '........',
    '.i.i.i.i',
    'iiiiiiii',
    '.iii.iii',
    '.i.i.i.i',
    '.i.i.i.i',
  ),
  scroll: art(
    'iiiiiiii',
    'issssssi',
    'iiiiiiii',
    'issssssi',
    'iiiiiiii',
    'issssssi',
    'iiiiiiii',
    '........',
  ),
  bond: art(
    '.rr..rr.',
    'r..rr..r',
    'r..rr..r',
    '.rr..rr.',
    '........',
    '..iiii..',
    '.i....i.',
    '..iiii..',
  ),
  reel: art(
    'iiiiiiii',
    'i.i..i.i',
    'iiiiiiii',
    'ihhhhhhi',
    'ihhhhhhi',
    'iiiiiiii',
    'i.i..i.i',
    'iiiiiiii',
  ),
  book: art(
    '.iiiiii.',
    '.iesssi.',
    '.iesssi.',
    '.ieiiii.',
    '.iesssi.',
    '.ieiiii.',
    '.iesssi.',
    '.iiiiii.',
  ),
  // a key, the same silhouette the timeline mark draws, so the two surfaces name one thing once
  find: art(
    '..iiii..',
    '.ii..ii.',
    '.ii..ii.',
    '..iiii..',
    '...ii...',
    '...iih..',
    '...ii...',
    '...iih..',
  ),
}

/** A glyph nobody has drawn is a filled square, never a crash and never a missing button. */
export function controlGlyph(id: string): GlyphPixel[] {
  return CONTROL_GLYPH[id] ?? CONTROL_GLYPH['fit']!
}
