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
  { selector: '.beat-card', why: 'a 13px want and try is 3.25px on a 480px player' },
  { selector: '.shot-board', why: 'what the camera nearly did is a director’s question' },
  { selector: '.dossier-rail', why: 'twenty-two bodies down the flank of a phone-sized picture' },
]

/**
 * Every caption the broadcast frame does show, and where its size comes from. `sheet` rows are
 * resolved from `chrome.css` by the test; the one `canvas` row is a bitmap face, not a CSS rule.
 */
export type BroadcastCaption =
  | { what: string; from: 'sheet'; selector: string }
  | { what: string; from: 'canvas'; px: number }

export const BROADCAST_CAPTIONS: readonly BroadcastCaption[] = [
  { what: 'a speech bubble', from: 'canvas', px: FACE_INSTALL_PX * BROADCAST_TEXT_SCALE },
  {
    what: 'the speaker’s name',
    from: 'sheet',
    selector: "[data-broadcast='on'] .lower-third-name",
  },
  { what: 'the caption', from: 'sheet', selector: "[data-broadcast='on'] .lower-third-words" },
  { what: 'the chronicle ticker', from: 'sheet', selector: "[data-broadcast='on'] .ticker-line" },
  { what: 'the day', from: 'sheet', selector: "[data-broadcast='on'] .day-bar-day" },
  { what: 'the dateline', from: 'sheet', selector: "[data-broadcast='on'] .day-bar-when" },
  { what: 'the town clock', from: 'sheet', selector: "[data-broadcast='on'] .day-bar-stamp" },
  { what: 'the weather', from: 'sheet', selector: "[data-broadcast='on'] .day-bar-weather" },
  { what: "the town's state", from: 'sheet', selector: "[data-broadcast='on'] .day-bar-state" },
  { what: 'the director’s cue', from: 'sheet', selector: "[data-broadcast='on'] .stage-cue" },
  { what: 'the scene card', from: 'sheet', selector: "[data-broadcast='on'] .scene-card-where" },
  {
    what: 'the scene card’s stamp',
    from: 'sheet',
    selector: "[data-broadcast='on'] .scene-card-title",
  },
  { what: 'the quiet band', from: 'sheet', selector: "[data-broadcast='on'] .story-quiet" },
  { what: 'the story strip', from: 'sheet', selector: "[data-broadcast='on'] .story-line" },
  { what: 'the story’s state', from: 'sheet', selector: "[data-broadcast='on'] .story-meta" },
]

export type SpokenLine = { agentId: string; name: string; words: string }

/** What the lower third is carrying. A speech caption brings the speaker's face with it; the
 *  narrator's own line does not, because a chapter has no speaker. */
export type LowerThirdLine =
  | { kind: 'speech'; agentId: string; name: string; words: string }
  | { kind: 'dispatch'; name: string; words: string }

/** Long enough to read a sentence at broadcast size, short enough not to outlive the shot. The
 *  hold is a timer the mark owns, not a clock this module reads, and it is counted from the
 *  moment the line has finished TYPING — otherwise a 140-character caption is read for a second. */
export const CAPTION_HOLD_MS = 6000

/** A caption is a caption, not a paragraph: what does not fit ends in an ellipsis. */
export const CAPTION_MAX_CHARS = 140

export function captionClip(text: string, max = CAPTION_MAX_CHARS): string {
  const line = text.trim().replace(/\s+/g, ' ')
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

/** Whoever is still talking, the newest dispatch the rest of the time, and nothing at all in a
 *  town that has neither. `spoken` is null once its hold has run out. */
export function lowerThirdLine(
  spoken: SpokenLine | null,
  dispatch: { title: string; body: string } | null,
): LowerThirdLine | null {
  if (spoken !== null) {
    return {
      kind: 'speech',
      agentId: spoken.agentId,
      name: spoken.name,
      words: captionClip(spoken.words),
    }
  }
  if (dispatch === null) return null
  return { kind: 'dispatch', name: captionClip(dispatch.title), words: captionClip(dispatch.body) }
}

/** How many entries the crawl carries. The record grows forever and a stream viewer reads the
 *  last minutes of it, not the whole town history. */
export const TICKER_MAX = 12
export const TICKER_SEP = ' · '

/** How fast the crawl moves, in CSS pixels a second. Slow enough to read at a glance on a
 *  480px-wide player, which is a quarter of the source frame. */
export const TICKER_PX_PER_S = 60

/** The newest entries, oldest first, so the line reads forward as it crawls. */
export function tickerText(
  entries: readonly { seq: number; label: string }[],
  max = TICKER_MAX,
): string {
  return [...entries]
    .sort((a, b) => a.seq - b.seq)
    .slice(-max)
    .map((e) => e.label)
    .join(TICKER_SEP)
}
