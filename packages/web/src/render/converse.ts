import { DEFAULT_CONFIG } from '@sj/shared'

// The three rules that make two lines read as one exchange, kept pure and apart from the drawing.

/** A reading pace. Faster and a viewer cannot tell which of two boxes is the one being said. */
export const TYPE_CHARS_PER_S = 28

/** Long enough to read an answered line beside its reply; it goes early on a third line. */
export const PRIOR_HOLD_MS = 6000
/** Six tenths, so the line being said now is the brighter of the two. */
export const PRIOR_ALPHA = 0.6

/** The speaker's OWN last line ends — two full slabs from one mouth read as one shout — and the
 *  partner's dims and holds. */
export type LineFate = 'end' | 'dim' | 'keep'
export function fateOfPriorLine(
  prior: { agentId: string; isThought: boolean; dimmed: boolean },
  speakerId: string,
): LineFate {
  if (prior.isThought) return 'keep'
  return prior.agentId === speakerId || prior.dimmed ? 'end' : 'dim'
}

/** ★ A THOUGHT IS ENDED BY THINKING, NEVER BY SPEECH. `fateOfPriorLine` keeps every prior
 *  thought — right, because a thought is not part of the exchange — so nothing ever ended one
 *  and they stacked until each timed out, two of them overlapping on screen. */
export const MAX_LIVE_THOUGHTS = 2

/** Which of the live thoughts end when `thinkerId` thinks: that mind's own earlier ones, always,
 *  and then the oldest of the rest while a third would stand. Indices into `live`. */
export function thoughtsToEnd(
  live: readonly { agentId: string; bornMs: number }[],
  thinkerId: string,
): number[] {
  const ending = new Set<number>()
  live.forEach((t, i) => {
    if (t.agentId === thinkerId) ending.add(i)
  })
  const rest = live
    .map((t, i) => ({ bornMs: t.bornMs, i }))
    .filter((e) => !ending.has(e.i))
    .sort((a, b) => a.bornMs - b.bornMs || a.i - b.i)
  for (const e of rest.slice(0, Math.max(0, rest.length + 1 - MAX_LIVE_THOUGHTS))) ending.add(e.i)
  return [...ending].sort((a, b) => a - b)
}

/** How much of a line of `len` characters has arrived `msSince` after it was spoken. */
export function typedChars(len: number, msSince: number): number {
  if (!(msSince > 0)) return 0
  return Math.min(len, Math.floor((msSince * TYPE_CHARS_PER_S) / 1000))
}

/** How long the whole line takes to arrive. */
export function typingMs(len: number): number {
  return Math.ceil((len * 1000) / TYPE_CHARS_PER_S)
}

/** The most voices worth remembering: this is who a body turns toward, not a transcript. */
const KEEP_VOICES = 12

/** Past this a voice is not being answered any more, it is just the last thing anybody said. */
export const REPLY_WINDOW_MS = 12_000

/** Nobody answers a voice they could not have heard. Read off the config rather than
 *  transcribed, so it cannot go stale the way a written 8 would. */
export const EARSHOT_TILES: number = DEFAULT_CONFIG.movement.earshotRadius

type Voice = { agentId: string; x: number; y: number; atMs: number }

/** Who holds the floor of a scene: the last of `ids` to have said anything. The floor PASSES,
 *  it never lapses — a silence in a scene is still that speaker's turn, not nobody's. */
export function floorHolder(ids: readonly string[], voices: readonly Voice[]): string | null {
  const cast = new Set(ids)
  for (let i = voices.length - 1; i >= 0; i--) {
    const id = voices[i]!.agentId
    if (cast.has(id)) return id
  }
  return null
}

/** Who a body turns to while a scene runs: everyone faces the floor, and the floor faces
 *  whoever held it before them. Null before anybody has spoken — a facing nobody has earned
 *  is a body swivelling on its own. */
export function faceInScene(
  agentId: string,
  ids: readonly string[],
  voices: readonly Voice[],
): string | null {
  const floor = floorHolder(ids, voices)
  if (floor === null) return null
  if (agentId !== floor) return floor
  return floorHolder(
    ids.filter((id) => id !== floor),
    voices,
  )
}

export type Conversation = {
  heard(v: Voice): void
  /** Who this speaker is answering: the last OTHER voice heard within earshot of where they are
   *  standing now, or null when they are talking to the air. */
  partnerOf(agentId: string, x: number, y: number, nowMs: number): string | null
  /** The voice log itself, so the floor rules above can be asked of it without a second one. */
  voices(): readonly Voice[]
}

export function createConversation(): Conversation {
  const voices: Voice[] = []
  return {
    heard(v) {
      voices.push(v)
      if (voices.length > KEEP_VOICES) voices.shift()
    },
    partnerOf(agentId, x, y, nowMs) {
      for (let i = voices.length - 1; i >= 0; i--) {
        const v = voices[i]!
        if (nowMs - v.atMs > REPLY_WINDOW_MS) return null
        if (v.agentId === agentId) continue
        if (Math.hypot(v.x - x, v.y - y) > EARSHOT_TILES) continue
        return v.agentId
      }
      return null
    },
    voices: () => voices,
  }
}
