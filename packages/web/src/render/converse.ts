import { DEFAULT_CONFIG } from '@sj/shared'

// ★ A CONVERSATION LOOKS LIKE ONE. Two people spoke and the town showed two paragraph slabs
// appearing wherever the placer put them, neither of them facing the other, the first gone
// before the second arrived. Nothing on the stage said the two lines were one exchange.

/** Read aloud, this is a natural pace, and a line that lands all at once gives a viewer no way
 *  to tell which of two boxes is the one being said now. */
export const TYPE_CHARS_PER_S = 28

/** How long a line stays once it has been answered — long enough to read the pair together, and
 *  it goes the moment the exchange moves on to a third line. */
export const PRIOR_HOLD_MS = 6000
/** ...at six tenths, so the line being said now is the brighter of the two. */
export const PRIOR_ALPHA = 0.6

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
