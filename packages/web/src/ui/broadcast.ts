/**
 * ★ THE BROADCAST LAYOUT — R2, the one readiness line no plan owned.
 *
 * R2 asks that every caption be legible at 1080p downscaled to a 480px-wide mobile Twitch
 * player. The scale is **0.25** (480 ÷ 1920), not the plan's 0.44, and at 0.25 the shipped
 * chrome lands its captions at 3.0–4.0px against a 5.4px floor. No token closes that: 22px
 * chrome on a 1920 stage is absurd for the person sitting in front of it.
 *
 * So the answer is not a bigger desktop. It is a SECOND COMPOSITION for a second audience.
 *
 * ### What a broadcast is not
 *
 * A stream has no operator. Nobody presses a lens tab, drags a timeline, or opens a postcard,
 * and at 480px none of those are even readable — a control bar at 44px per item is eleven
 * 11px smudges. Chrome a viewer can neither read nor press is not shrunk in this layout, it
 * is REMOVED (`BROADCAST_REMOVED`). What is left is a picture and the two things a stranger
 * arriving mid-stream has to be told: **what time it is in the town, and who is speaking.**
 *
 * ### What survives the downscale
 *
 * Everything still on screen is at or above `captionFloorPx()`, measured at the true 0.25 —
 * see `BROADCAST_CAPTIONS`, whose sizes the test reads off the shipped stylesheet so a token
 * change moves the number rather than quietly passing.
 *
 * Two things are absent rather than enlarged, and both are measured, not assumed:
 *  - **world name tags** are hover-only (`characters.ts` binds them to pointerover), and an
 *    unattended broadcast has no pointer;
 *  - **place-name plates** fade out at and above 1× (`landmarkAlpha`), and the broadcast sits
 *    at `DIRECTOR_ZOOM` = 3, so they are never in the frame at all.
 *
 * ### What triggers it
 *
 * `?broadcast=1` in the URL — the address you paste into an OBS browser source — and nothing
 * else. NEVER a viewport width: a layout this large firing on a narrow desktop window would
 * be a regression for the ordinary viewer, who is sitting two feet from the screen.
 */

import { BROADCAST_TEXT_SCALE, FACE_INSTALL_PX } from '../render/textFaces.js'

/** The one switch. Named here so the router and the report cannot spell it differently. */
export const BROADCAST_PARAM = 'broadcast'

export function broadcastFromSearch(search: string): boolean {
  return new URLSearchParams(search).get(BROADCAST_PARAM) === '1'
}

/**
 * Every operator surface the broadcast frame removes, with the reason. A row here is a claim
 * that the surface is navigation rather than reading — `broadcast.test.ts` holds the sheet to
 * it, so nothing can be quietly left in the frame at 3px.
 */
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
 * resolved from `chrome.css` by the test; the one `canvas` row is the world's own speech,
 * whose size is a bitmap face rather than a CSS rule.
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
