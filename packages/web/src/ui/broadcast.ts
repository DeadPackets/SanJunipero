/**
 * At 0.25 (1080p into a 480px mobile player) the desktop chrome's captions land at 3.0–4.0px
 * against a 5.4px floor, so this is a SECOND composition. `?broadcast=1` only — NEVER a viewport
 * width, which would fire on a narrow desktop window.
 */

import { BROADCAST_TEXT_SCALE, FACE_INSTALL_PX } from '../render/textFaces.js'

/** The one switch. Named here so the router and the report cannot spell it differently. */
export const BROADCAST_PARAM = 'broadcast'

export function broadcastFromSearch(search: string): boolean {
  return new URLSearchParams(search).get(BROADCAST_PARAM) === '1'
}

/** Every operator surface the broadcast frame removes, with the reason. `broadcast.test.ts` holds
 *  the sheet to it, so nothing can be quietly left in the frame at 3px. */
export const BROADCAST_REMOVED: readonly { selector: string; why: string }[] = [
  { selector: '.signpost', why: 'four arms nobody watching a stream can press' },
  { selector: '.paper', why: 'a 760px reading sheet is 190px on a phone' },
  { selector: '.town-dim', why: 'the sheet is gone, so what it dimmed for is gone too' },
  { selector: '.fps-overlay', why: 'an instrument, not a picture' },
]

/**
 * Every caption the broadcast frame does show, and where its size comes from. `sheet` rows are
 * resolved from `chrome.css` by the test; the one `canvas` row is a bitmap face, not a CSS rule.
 */
export type BroadcastCaption =
  | { what: string; from: 'sheet'; selector: string }
  | { what: string; from: 'canvas'; px: number }

// The stamp and the cue are the stage's own marks (web/src/stage): their sheet rows join this
// table when they land, and until then the frame is measured by the one caption it draws itself.
export const BROADCAST_CAPTIONS: readonly BroadcastCaption[] = [
  { what: 'a speech bubble', from: 'canvas', px: FACE_INSTALL_PX * BROADCAST_TEXT_SCALE },
]
