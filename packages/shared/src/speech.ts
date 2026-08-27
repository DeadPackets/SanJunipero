// An utterance is the only untrusted string in a prompt. The forgery primitive is the quote
// character, not the newline: perceptionToProse joins with spaces, so " is downgraded to '.
// Block 1 gets no matching sentence: telling a mind how quotes work names the machinery.

/** What a listener takes in from one utterance. Past the 28-word burst of every voice card. */
export const SPEECH_MAX_CHARS = 240

/** What the world will accept as an utterance at all. Not a style rule — a size bound, so no
 *  channel that ever reaches `speak` can put 12 KB into an event log, a viewer or a prompt. */
export const SPEECH_INPUT_MAX_CHARS = 2000

// The double-quote family only. The apostrophe is deliberately absent: stripping it would
// break "don't", and a single quote cannot terminate the fence.
const DOUBLE_QUOTES = /["«»“”„‟″]/gu

/** One utterance, made safe to interpolate: one line, no fence character, bounded. Idempotent,
 *  because it runs both where speech enters the world and where it reaches a mind. */
export function sanitizeSpokenText(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim().replace(DOUBLE_QUOTES, "'")
  if (flat.length <= SPEECH_MAX_CHARS) return flat
  return `${flat.slice(0, SPEECH_MAX_CHARS - 1).trimEnd()}…`
}

/** One utterance, as a listener reads it. The only untrusted string in a prompt; sanitized here
 *  as well as at the verb, because a world resumed from an older log carries raw text. */
export function heardLine(name: string, text: string): string {
  return `You hear ${name} say: "${sanitizeSpokenText(text)}" (from nearby)`
}
