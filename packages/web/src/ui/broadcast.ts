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
export const BROADCAST_REMOVED: ReadonlyArray<{ selector: string; why: string }> = [
  { selector: '.px-title', why: 'the channel already says whose town it is' },
  { selector: '.lens-tabs', why: 'nobody is navigating' },
  { selector: '.link-pill', why: 'the badge states the same trouble in a word (R8)' },
  { selector: '.status-strip', why: 'its figures repeat the clock at 12px' },
  { selector: '.control-bar', why: 'eleven controls nobody can press' },
  { selector: '.hud-dock', why: 'a menu for arranging chrome that is gone' },
  { selector: '#panel-outlet', why: 'a 368px reading panel is 92px on a phone' },
  { selector: '.timeline', why: 'a scrub track with no hand on it' },
  { selector: '.film-strip', why: 'postcard navigation; its titles are 14px' },
  { selector: '.moment-player', why: 'transport for a recorded day nobody opened' },
  { selector: '.fps-overlay', why: 'an instrument, not a picture' },
  { selector: '.scrub-banner', why: 'a broadcast is live by construction' },
  { selector: '.room-card', why: 'a way back out of a room nobody walked into' },
  { selector: '.digest-scrim', why: 'a modal with nobody there to dismiss it' },
]

/**
 * Every caption the broadcast frame does show, and where its size comes from. `sheet` rows are
 * resolved from `chrome.css` by the test; the one `canvas` row is a bitmap face, not a CSS rule.
 */
export type BroadcastCaption =
  | { what: string; from: 'sheet'; selector: string }
  | { what: string; from: 'canvas'; px: number }

export const BROADCAST_CAPTIONS: readonly BroadcastCaption[] = [
  { what: 'the clock', from: 'sheet', selector: "[data-broadcast='on'] .tick-badge" },
  { what: 'the speaker', from: 'sheet', selector: "[data-broadcast='on'] .subtitle-name" },
  { what: 'what they said', from: 'sheet', selector: "[data-broadcast='on'] .subtitle" },
  { what: 'a speech bubble', from: 'canvas', px: FACE_INSTALL_PX * BROADCAST_TEXT_SCALE },
]
