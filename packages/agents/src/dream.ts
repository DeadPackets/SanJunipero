import { MINUTES_PER_DAY } from '@sj/shared'
import { RngStream } from '@sj/engine'
import { MemoryStore, type MemoryRow, type MemoryTags } from './memory/store.js'

const FRAGMENT_COUNT = 6
const DREAM_IMPORTANCE = 6
const LAST_DAYS = 3

export type DreamResult =
  | { dreamed: false }
  | { dreamed: true; text: string; mood: string; memoryId: number }

export type DreamLlm = {
  composeDream(fragments: MemoryRow[]): Promise<{ text: string; mood: string }>
}

export async function rollDream(deps: {
  mem: MemoryStore
  agentId: string
  day: number
  llm: DreamLlm
  chance: number
}): Promise<DreamResult> {
  const { mem, agentId, day, llm, chance } = deps
  const stream = RngStream.seed(agentId, `dream:${day}`)
  if (stream.next() >= chance) return { dreamed: false }

  const candidates: MemoryRow[] = []
  for (let d = day - (LAST_DAYS - 1); d <= day; d += 1) {
    candidates.push(...mem.memoriesOfDay(d))
  }
  candidates.sort((a, b) => b.importance - a.importance || a.id - b.id)
  const fragments = shuffle(candidates.slice(0, FRAGMENT_COUNT), stream)

  const { text, mood } = await llm.composeDream(fragments)

  const memoryId = await mem.insertMemory({
    tick: day * MINUTES_PER_DAY + MINUTES_PER_DAY - 1,
    kind: 'dream',
    text,
    importance: DREAM_IMPORTANCE,
    tags: unionTags(fragments),
  })

  return { dreamed: true, text, mood, memoryId }
}

function shuffle<T>(items: T[], stream: RngStream): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = stream.int(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function unionTags(fragments: MemoryRow[]): MemoryTags {
  const people = new Set<string>()
  const places = new Set<string>()
  const objects = new Set<string>()
  const topics = new Set<string>()
  for (const f of fragments) {
    for (const p of f.tags.people) people.add(p)
    for (const o of f.tags.objects) objects.add(o)
    for (const t of f.tags.topics) topics.add(t)
    if (f.tags.place !== null) places.add(f.tags.place)
  }
  return {
    people: [...people],
    place: places.size === 1 ? [...places][0] : null,
    objects: [...objects],
    topics: [...topics],
  }
}
