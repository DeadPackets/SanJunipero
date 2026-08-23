/**
 * U24 — HOW FAR FROM TWITCH-READY, MEASURED.
 *
 * The user acknowledged the gap and stated it plainly: *"it really feels a very far distance
 * from being that ready."* This module MEASURES the distance rather than asserting it is gone.
 * Four of the eight conditions are machine-checkable and are checked here; the other four are
 * a protocol a person runs, and the report carries a measured value for those too.
 */
export type ReadinessLine = { id: string; requirement: string; measured: string; pass: boolean }

export const READINESS: readonly string[] = [
  'R1  ten unattended minutes with no empty frame, no error toast, no stalled camera',
  'R2  every caption legible at 1080p downscaled to a 480px-wide mobile Twitch player',
  'R3  a viewer joining at any second understands who they are looking at within 10s',
  'R4  nothing on screen is a machine word, an id, or a number without a unit',
  'R5  a death, a birth and a build each read differently without sound',
  'R6  the frame rate holds >= 58fps for the whole ten minutes with everything live',
  'R7  no layout at 1280x800, 1440x900 or 1920x1080 clips, overlaps or scrolls horizontally',
  'R8  the stream survives a socket drop and a reconnect without lying about the clock',
]

/** The machine-checkable half. Named, so the report cannot quietly promote a human line. */
export const MACHINE_CHECKABLE: readonly string[] = ['R2', 'R4', 'R7', 'R8']

export function readinessReport(lines: readonly ReadinessLine[]): string {
  const rows = lines.map((l) =>
    `| ${l.id} | ${l.requirement} | ${l.measured} | ${l.pass ? 'PASS' : 'OPEN'} |`)
  return [
    '| id | requirement | measured | verdict |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n')
}

// ── R4 · nothing on screen is a machine word ──────────────────────────────────────────────
//
// The rule already existed and was already written down — `place.ts` says "a kind is a slug in
// the engine and prose here — the underscore never reaches a viewer" — and three other string
// producers did not apply it. The chronicle read **"The fire_pit is finished."** on screen.

/** A word with an underscore inside it: an engine slug that escaped. */
const SLUG = /\b[a-z]+_[a-z_]+\b/
/** A dotted path: `spoilage.days`, `weather.hourlyChangeChance`. */
const DOTTED = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){1,}\b/i
/** An id shape: a uuid, or `structure_house_14_13`. */
const IDLIKE = /\b[0-9a-f]{8}-[0-9a-f]{4}|\b(?:structure|agent|item|crop)_[a-z0-9_]+/i
/** A big bare integer: no unit after it, not a clock, not a day. `4820` on screen tells a
 *  viewer nothing; `Day 120`, `82%`, `19:31` and `3 days` all tell them something. */
const UNITS = 'px|ms|s|days?|nights?|ticks?|people|steps?|of\\b'
const BARE_INT = new RegExp(`(?<!Day\\s)(?<![\\d.:%])\\b\\d{3,}\\b(?![\\d.:%]|\\s*(?:${UNITS}))`, 'i')

export type StringSite = { where: string; text: string }

/** `where — text` for every string that shows a viewer something only a machine says. */
export function machineWordOffenders(sites: readonly StringSite[]): string[] {
  const out: string[] = []
  for (const s of sites) {
    for (const [name, re] of [['slug', SLUG], ['path', DOTTED], ['id', IDLIKE], ['number', BARE_INT]] as const) {
      if (re.test(s.text)) out.push(`${s.where} — ${name} — ${JSON.stringify(s.text)}`)
    }
  }
  return out
}

/** A kind is a slug in the engine and PROSE to a viewer. One owner for the conversion, so a
 *  fourth call site cannot forget it the way three already did. */
export function kindWords(kind: string): string {
  return kind.replace(/_/g, ' ')
}

// ── R2 · a caption legible on a phone ─────────────────────────────────────────────────────

/**
 * ★ THE PLAN'S 0.44 IS THE WRONG NUMBER, AND IT FLATTERS US BY 78%. "1080p" is 1920 x 1080,
 * and the mobile player is 480 CSS px WIDE — so the scale is 480/1920 = 0.25, not 480/1080.
 * Every caption figure below is 56% of what the plan's factor would have reported.
 */
export const TWITCH_SOURCE_W = 1920, TWITCH_SOURCE_H = 1080
export const TWITCH_PLAYER_W = 480
export const TWITCH_SCALE = TWITCH_PLAYER_W / TWITCH_SOURCE_W
/** The frame, at that scale, in the viewer's pixels: 480 x 270. */
export const TWITCH_FRAME_H = Math.round(TWITCH_SOURCE_H * TWITCH_SCALE)
/**
 * Subtitle guidance (EBU-TT / BBC family) puts a caption's type at no less than 2% of frame
 * height. At 480x270 that is 5.4 px — so a 14 px caption survives the downscale at 6.22 px and
 * a 12 px one does not, at 5.33 px. The floor is a fraction of the FRAME, never a fixed pixel
 * count, because that is what actually holds when a stream is re-encoded.
 */
export const CAPTION_MIN_FRACTION = 0.02
export const captionMinPx = (frameH = TWITCH_FRAME_H): number => frameH * CAPTION_MIN_FRACTION

export const captionAtScale = (px: number, scale = TWITCH_SCALE): number => px * scale

export function captionReads(px: number, scale = TWITCH_SCALE, frameH = TWITCH_FRAME_H): boolean {
  return captionAtScale(px, scale) >= captionMinPx(frameH)
}

/** The smallest source size that survives the downscale, rounded up to a whole pixel. */
export function captionFloorPx(scale = TWITCH_SCALE, frameH = TWITCH_FRAME_H): number {
  return Math.ceil(captionMinPx(frameH) / scale)
}

export type Caption = { what: string; px: number }

/**
 * `what — Npx of Mpx` for every caption that does NOT survive the downscale.
 *
 * Run over the DESKTOP chrome this is a standing measurement, not a failure: 22px type on a
 * 1920 stage is absurd for the person sitting in front of it, and the four numbers below are
 * exactly why `ui/broadcast.ts` exists. Run over `BROADCAST_CAPTIONS` it is empty, and that is
 * what closes R2 — see `broadcast.test.ts`.
 */
export function captionShortfall(captions: readonly Caption[]): string[] {
  return captions
    .filter((c) => !captionReads(c.px))
    .map((c) => `${c.what} — ${captionAtScale(c.px).toFixed(2)}px of ${captionMinPx().toFixed(1)}px`)
}

// ── R7 · the three broadcast widths ───────────────────────────────────────────────────────

export const BROADCAST_WIDTHS = [1280, 1440, 1920] as const
/** The chrome's fixed rails, in CSS px, read off the sheet's own tokens by the test. */
export type Rails = { panel: number; stripCard: number; controlItem: number; controlCount: number }
/** A stage narrower than this cannot show a town, and the layout is a failure rather than a
 *  scroll: horizontal scrolling is the specific thing R7 forbids. */
export const STAGE_MIN_PX = 640

export function stageWidthAt(width: number, rails: Rails): number {
  return width - rails.panel
}

/** `width — why` for every broadcast width the chrome does not fit in. */
export function layoutOffenders(rails: Rails, widths: readonly number[] = BROADCAST_WIDTHS): string[] {
  const out: string[] = []
  for (const w of widths) {
    const stage = stageWidthAt(w, rails)
    if (stage < STAGE_MIN_PX) out.push(`${w} — stage is ${stage}px with the panel open, under ${STAGE_MIN_PX}`)
    const bar = rails.controlItem * rails.controlCount
    if (bar > stage) out.push(`${w} — the control bar needs ${bar}px and has ${stage}px`)
    if (rails.stripCard * 2 > stage) out.push(`${w} — the filmstrip cannot show two postcards`)
  }
  return out
}

// ── R8 · the stream never lies about the clock ────────────────────────────────────────────
//
// AUDIT M9: with the socket down, the tick badge went on reading `Now · Day 0 · 19:31` in its
// live colour. A broadcast that keeps showing a confident clock it is no longer being told
// about is worse than one that shows nothing — the viewer has no way to know.

/** socket.ts's own vocabulary, not a second copy of it. */
export type LinkState = 'connecting' | 'online' | 'reconnecting'
export type BadgeState = 'waking' | 'live' | 'past' | 'stale'

export function tickBadgeState(link: LinkState, live: boolean, awake: boolean): BadgeState {
  if (!awake) return 'waking'
  if (link !== 'online') return 'stale'  // the figures are the last ones we were told
  return live ? 'live' : 'past'
}

export const BADGE_WORD: Readonly<Record<BadgeState, string>> = {
  waking: 'Waking…',
  live: 'Now',
  past: 'Back then',
  stale: 'Last seen',
}

/** Whether the figures beside the badge are still being told to us. */
export const figuresAreLive = (s: BadgeState): boolean => s === 'live' || s === 'past'
