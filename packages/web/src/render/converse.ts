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

export type Voice = { agentId: string; x: number; y: number; atMs: number }

export type Conversation = {
  heard(v: Voice): void
  /** Who this speaker is answering: the last OTHER voice heard within earshot of where they are
   *  standing now, or null when they are talking to the air. */
  partnerOf(agentId: string, x: number, y: number, nowMs: number): string | null
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
  }
}
