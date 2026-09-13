import { type DayPhase, type Moment, dayPhaseFromTick, tickToMoment } from '@sj/shared'
import { attr } from './http.js'
import { CARD_HEIGHT, CARD_WIDTH } from './agentCard.js'

// A REAL POSTCARD, not a test pattern. `momentThumb.ts` said a thumbnail of a moment would need
// a second headless renderer; it does not. `sharp` is already here and `agentCard.ts` already
// crops a bust out of the atlas, so a card is a tinted plate, the faces that were there, the
// place and the title — composed once and memoised by the raster cache like every other card.

/** How many faces fit across the plate before they are a crowd rather than a cast. */
export const CARD_CAST_MAX = 3

const PAD = 72
const BUST = 200
const BUST_GAP = 24

/** The hour, as the plate's own paper. The town's own phase boundary, so a card and the light
 *  on the town cannot disagree about when it got dark. */
const PLATE: Readonly<Record<DayPhase, { ground: string; ink: string; quiet: string }>> = {
  dawn: { ground: '#F6E8D5', ink: '#43394A', quiet: '#5F5568' },
  day: { ground: '#FFF6E9', ink: '#43394A', quiet: '#5F5568' },
  dusk: { ground: '#E8785A', ink: '#241F2B', quiet: '#3A2E33' },
  night: { ground: '#241F2B', ink: '#FFF6E9', quiet: '#C4B8AE' },
}

export function platePaint(tick: number): { ground: string; ink: string; quiet: string } {
  return PLATE[dayPhaseFromTick(tick)]
}

/** The line under the title: the minute, the place, and who was there. Never a coordinate — the
 *  location arrives already written as words, or not at all. */
export function cardDateline(m: Moment, names: (id: string) => string): string {
  const at = tickToMoment(m.startTick)
  const cast = m.cast.slice(0, CARD_CAST_MAX).map(names)
  const rest = m.cast.length - cast.length
  const who = cast.length === 0 ? '' : cast.join(', ') + (rest > 0 ? ` +${rest}` : '')
  return [`Day ${at.day} · ${at.time}`, m.location, who]
    .filter((p) => p !== null && p !== '')
    .join(' · ')
}

/** Wrapped by measure rather than by character count: Georgia at 60px runs about 0.5em average,
 *  so a line of the plate's own width is roughly this many. Two lines, then it is cut. */
export function titleLines(title: string, perLine = 26, max = 2): string[] {
  const out: string[] = []
  let line = ''
  for (const word of title.split(/\s+/)) {
    if (line === '') line = word
    else if (line.length + 1 + word.length <= perLine) line += ` ${word}`
    else {
      out.push(line)
      if (out.length === max) return out
      line = word
    }
  }
  if (line !== '' && out.length < max) out.push(line)
  return out
}

export function renderMomentCard(
  m: Moment,
  busts: readonly (string | null)[],
  names: (id: string) => string,
): string {
  const paint = platePaint(m.startTick)
  const faces = busts.slice(0, CARD_CAST_MAX).filter((b): b is string => b !== null)
  const bustsY = CARD_HEIGHT - PAD - BUST
  const lines = titleLines(m.title)
  const titleY = bustsY - 40 - (lines.length - 1) * 68
  const t = (s: string): string => attr(s)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">` +
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${paint.ground}"/>` +
    // the town's one accent, along the top, exactly as the agent card wears it
    `<rect x="0" y="0" width="${CARD_WIDTH}" height="8" fill="#F2C879"/>` +
    faces
      .map(
        (uri, i) =>
          `<image href="${uri}" x="${PAD + i * (BUST + BUST_GAP)}" y="${bustsY}" width="${BUST}" height="${BUST}" image-rendering="pixelated"/>`,
      )
      .join('') +
    lines
      .map(
        (line, i) =>
          `<text x="${PAD}" y="${titleY + i * 68}" font-family="Georgia, serif" font-size="60" font-weight="bold" fill="${paint.ink}">${t(line)}</text>`,
      )
      .join('') +
    `<text x="${PAD}" y="${PAD + 40}" font-family="Georgia, serif" font-size="30" fill="${paint.quiet}">${t(cardDateline(m, names))}</text>` +
    `</svg>`
  )
}

/** The scene a shared `/moment/:day/:time` link is about: the one running at that minute, or the
 *  day's own lead when the link points between rooms. */
export function momentAt(moments: readonly Moment[], tick: number, day: number): Moment | null {
  const running = moments.find((m) => tick >= m.startTick && tick <= m.endTick)
  if (running !== undefined) return running
  // `moments` already arrives newest day first and highest stakes first inside a day.
  return moments.find((m) => m.day === day) ?? null
}
