import { setTimeout as pause } from 'node:timers/promises'
import { BudgetExceededError } from '@sj/llm'
import type { MemoryRow, MemoryStore } from './store.js'

/** Below this a row is already its own gist, and the call would cost more than it saves. */
export const GIST_MIN_CHARS = 400

export type GistLlm = { gist(text: string): Promise<string> }

// A mark is the only handle an act has on a thing: a short form that paraphrases
// `item_..._bread` as "bread" leaves the next turn unable to name what it reaches for.
export const GIST_SYSTEM = [
  'One moment of your day comes back to you. Set it down in short.',
  'Copy every mark exactly as it is written (item_..., structure_..., node_...) beside the thing',
  'it names. Write each mark out in full, one for each thing; never shorten one, never rename one,',
  'never fold several into a shared stem, never leave one out.',
  'Keep every number, every promise made or owed, every want of yours, and who did what to whom.',
  'Let go of the weather, the scenery, and anything the moment only says twice.',
  'Answer with the short form alone, in two sentences or three.',
].join('\n')

/** What a memory is worth sending: the night's short form once it has one. */
export function promptText(m: MemoryRow): string {
  return m.gist ?? m.text
}

export function needsGist(m: MemoryRow): boolean {
  const kind = m.kind === 'perception' || m.kind === 'action'
  return m.gist === null && kind && m.text.length > GIST_MIN_CHARS
}

// A busy day leaves ~170 long rows. Serially that is minutes of night; four lanes is the same
// width the replay harness runs at, and the budget guard books each call as it goes out.
export const GIST_LANES = 4

// A row refused tonight keeps `gist === null`, so the next night's batch picks it up again.
// Six in a row is the endpoint refusing the night rather than the rows, and the batch stops.
export const GIST_MAX_CONSECUTIVE_FAILURES = 6

// How much of the backlog one night takes on top of its own day. A mind that lost a week of
// gists catches up over the nights that follow rather than spending one of them entirely.
const GIST_MAX_BACKLOG = 100

// Both live causes of a refused gist are a busy endpoint, not a bad row: 68% upstream 429s,
// 32% stalls that ran out the bound. Taking the next row with no pause re-enters both.
const GIST_RETRY_PAUSE_MS = 2_000

export type GistBatch = {
  written: number
  /** Rows that wanted a gist tonight. `written / eligible` is the night's coverage. */
  eligible: number
  failed: number
}

/** One call per long raw row, written beside it. A gist that came back no shorter than the row
 *  it replaces is thrown away rather than stored. A refused row is skipped, not raised — the
 *  night's gists are the one thing it can lose without losing what it learned — and the nights
 *  after it take the leftovers, which is why the queue is today's rows plus the backlog. */
export async function gistMemories(
  mem: MemoryStore,
  llm: GistLlm,
  memories: MemoryRow[],
  sleep: (ms: number) => Promise<void> = pause,
): Promise<GistBatch> {
  const today = memories.filter(needsGist)
  const seen = new Set(today.map((m) => m.id))
  const backlog = mem.ungistedMemories(GIST_MIN_CHARS, GIST_MAX_BACKLOG)
  const queue = [...today, ...backlog.filter((m) => !seen.has(m.id))]
  let next = 0
  let written = 0
  let failed = 0
  let streak = 0
  const lane = async (): Promise<void> => {
    for (let i = next++; i < queue.length && streak < GIST_MAX_CONSECUTIVE_FAILURES; i = next++) {
      const m = queue[i]!
      try {
        const gist = (await llm.gist(m.text)).trim()
        streak = 0
        if (gist.length === 0 || gist.length >= m.text.length) continue
        mem.putGist(m.id, gist)
        written += 1
      } catch (err) {
        // A night with no headroom left is not a busy endpoint: it latches the whole reflection.
        if (err instanceof BudgetExceededError) throw err
        failed += 1
        streak += 1
        if (streak >= GIST_MAX_CONSECUTIVE_FAILURES) break
        await sleep(GIST_RETRY_PAUSE_MS * streak)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(GIST_LANES, queue.length) }, lane))
  return { written, eligible: queue.length, failed }
}
