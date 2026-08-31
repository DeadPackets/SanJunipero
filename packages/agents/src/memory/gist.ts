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
const GIST_LANES = 4

/** One call per long raw row, written beside it. A gist that came back no shorter than the row
 *  it replaces is thrown away rather than stored. */
export async function gistMemories(
  mem: MemoryStore,
  llm: GistLlm,
  memories: MemoryRow[],
): Promise<number> {
  const queue = memories.filter(needsGist)
  let next = 0
  let written = 0
  const failures: Error[] = []
  const lane = async (): Promise<void> => {
    for (let i = next++; i < queue.length && failures.length === 0; i = next++) {
      const m = queue[i]!
      try {
        const gist = (await llm.gist(m.text)).trim()
        if (gist.length === 0 || gist.length >= m.text.length) continue
        mem.putGist(m.id, gist)
        written += 1
      } catch (err) {
        failures.push(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(GIST_LANES, queue.length) }, lane))
  const first = failures[0]
  if (first !== undefined) throw first
  return written
}
