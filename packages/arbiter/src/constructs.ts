import { z } from 'zod'
import { assertQuotedName, type LlmClient } from '@sj/agents'
import { effectiveConfig, TOGGLABLE_PATHS } from '@sj/engine'
import { MINUTES_PER_DAY, type SimConfig, type SimEvent } from '@sj/shared'
import type { ConstructStore } from './constructStore.js'

// The recognizer names a TYPE; the name itself is the town's, quoted from a mouth or left null.
// Nothing here may reach a prompt, a perception packet, world state or the hash.

export const CONSTRUCT_TYPES = ['festival', 'faith', 'council', 'market', 'custom'] as const
export type ConstructType = (typeof CONSTRUCT_TYPES)[number]

export const ConstructSchema = z.object({
  id: z.string().min(1),
  type: z.enum(CONSTRUCT_TYPES),
  name: z.string().min(1).nullable(),
  nameProvenance: z.object({
    eventSeq: z.number().int().nonnegative(), quote: z.string().min(1), byId: z.string().min(1),
  }).strict().nullable(),
  anchor: z.union([
    z.object({ x: z.number().int(), y: z.number().int() }).strict(),
    z.string().min(1),
  ]).nullable(),
  participants: z.array(z.string().min(1)),
  firstTick: z.number().int().nonnegative(),
  recurrences: z.array(z.object({
    tick: z.number().int().nonnegative(), participants: z.array(z.string().min(1)),
  }).strict()),
}).strict()
export type Construct = z.infer<typeof ConstructSchema>

export type ConstructOpsType = 'construct_recognized' | 'construct_named' | 'construct_recurred'
export type ConstructOpsEvent = { type: ConstructOpsType; constructId: string; tick: number; payload: unknown }

// How near two bodies must be to be at the same thing. A module const, not a dial: G11b tunes
// the world by its genesis, not by a config row nobody would ever turn (batch-4 ruling 4).
const ANCHOR_CELL = 4

export type Gathering = { tick: number; participants: string[] }
export type CandidateName = { eventSeq: number; quote: string; byId: string; name: string }
export type Candidate = {
  key: string
  anchor: { x: number; y: number }
  participants: string[]
  firstTick: number
  gatherings: Gathering[]
  // Evidence, never a gate: recurrence at a place is what makes a candidate, and these are
  // what let a classifier tell a market from a council.
  signals: { expressive: number; offerings: number; sharedTokens: string[]; deferredTo: string | null }
  name: CandidateName | null
}

type Presence = { tick: number; agentId: string; x: number; y: number; ev: SimEvent }

// Where a body was, from whichever events say so. Nothing here reads world state.
function presenceOf(ev: SimEvent): Presence | null {
  const p = ev.payload as Record<string, unknown> | null
  if (p === null) return null
  const id = ev.type === 'agent_moved' ? p.id : ev.type === 'item_taken' ? p.takerId : p.agentId
  if (typeof id !== 'string' || typeof p.x !== 'number' || typeof p.y !== 'number') return null
  if (!['agent_moved', 'agent_spoke', 'agent_expressed', 'item_taken'].includes(ev.type)) return null
  return { tick: ev.tick, agentId: id, x: p.x, y: p.y, ev }
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= ANCHOR_CELL

const centroid = (ps: Array<{ x: number; y: number }>): { x: number; y: number } => ({
  x: Math.round(ps.reduce((t, p) => t + p.x, 0) / ps.length),
  y: Math.round(ps.reduce((t, p) => t + p.y, 0) / ps.length),
})

// Greedy clustering seeded in the given order, so the same input always yields the same
// groups. A grid would put two bodies standing side by side in different cells.
function clusterBy<T extends { x: number; y: number }>(items: T[]): T[][] {
  const clusters: Array<{ seed: { x: number; y: number }; items: T[] }> = []
  for (const item of items) {
    const hit = clusters.find((c) => near(c.seed, item))
    if (hit === undefined) clusters.push({ seed: { x: item.x, y: item.y }, items: [item] })
    else hit.items.push(item)
  }
  return clusters.map((c) => c.items)
}

// Words worth noticing when two nights use the same ones. Common speech is filtered out so a
// shared token means something the gathering actually shares.
const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'we', 'i', 'you', 'it', 'is', 'are', 'was', 'were', 'to',
  'of', 'in', 'on', 'at', 'for', 'this', 'that', 'now', 'then', 'here', 'there', 'call', 'again',
])

// A name arrives only out of a mouth. These are the shapes a town uses to give one; the whole
// utterance is kept as the quote, so the name can always be checked back against it verbatim.
const NAME_PATTERNS: readonly RegExp[] = [
  /\bwe call (?:it|this|them|these|ourselves) (?:the )?([\p{Lu}][\p{L}' -]{1,39})/u,
  /\bcall(?:ed)? it (?:the )?([\p{Lu}][\p{L}' -]{1,39})/u,
  /\bthis is (?:the )?([\p{Lu}][\p{L}' -]{1,39})/u,
]

function nameIn(ev: SimEvent): CandidateName | null {
  const p = ev.payload as { agentId?: unknown; text?: unknown } | null
  if (typeof p?.text !== 'string' || typeof p.agentId !== 'string') return null
  const source = { sourceKind: 'speech' as const, text: p.text, eventSeq: ev.seq, byId: p.agentId }
  for (const re of NAME_PATTERNS) {
    const found = re.exec(p.text)?.[1]?.replace(/[.,!?;:]+$/, '').trim()
    if (found === undefined || found.length < 2) continue
    // Verbatim or nothing, through the one enforcement point of the naming law (G9).
    const quoted = assertQuotedName(found, [source])
    if (quoted !== null) return { eventSeq: quoted.eventSeq, quote: quoted.quote, byId: quoted.byId, name: quoted.name }
  }
  return null
}

// Deterministic heuristics, entirely outside world state: bodies that keep coming back to the
// same ground. Everything else the pass knows is evidence hung off that fact.
export function detectCandidates(events: SimEvent[], config: SimConfig): Candidate[] {
  const cfg = config.constructs
  if (!cfg.enabled) return []

  // One occasion = bodies standing together on one day.
  const byDay = new Map<number, Presence[]>()
  for (const ev of events) {
    const pr = presenceOf(ev)
    if (pr === null) continue
    const day = Math.floor(ev.tick / MINUTES_PER_DAY)
    const list = byDay.get(day)
    if (list === undefined) byDay.set(day, [pr])
    else list.push(pr)
  }

  type Occasion = { tick: number; x: number; y: number; participants: string[]; presences: Presence[] }
  const occasions: Occasion[] = []
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    for (const group of clusterBy(byDay.get(day)!)) {
      const participants = [...new Set(group.map((p) => p.agentId))].sort()
      if (participants.length < cfg.minParticipants) continue
      const at = centroid(group)
      occasions.push({ tick: Math.min(...group.map((p) => p.tick)), ...at, participants, presences: group })
    }
  }

  const out: Candidate[] = []
  // The same ground on later days is the same site: cluster the occasions themselves, in
  // tick order, so the earliest gathering seeds the place.
  for (const all of clusterBy(occasions)) {
    const first = all[0]!
    const window = all.filter((g) => g.tick - first.tick <= cfg.windowDays * MINUTES_PER_DAY)
    if (window.length - 1 < cfg.minRecurrences) continue

    const presences = window.flatMap((g) => g.presences)
    const speech = presences.filter((p) => p.ev.type === 'agent_spoke')
    const tokens = new Map<string, Set<string>>()
    for (const s of speech) {
      const text = String((s.ev.payload as { text?: unknown }).text ?? '')
      for (const raw of text.toLowerCase().split(/[^\p{L}']+/u)) {
        if (raw.length < 3 || STOPWORDS.has(raw)) continue
        const speakers = tokens.get(raw) ?? new Set<string>()
        speakers.add(s.agentId)
        tokens.set(raw, speakers)
      }
    }
    const turns = new Map<string, number>()
    for (const s of speech) turns.set(s.agentId, (turns.get(s.agentId) ?? 0) + 1)
    const loudest = [...turns.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]
    const anchor = centroid(presences)

    let name: CandidateName | null = null
    for (const s of speech) {
      const found = nameIn(s.ev)
      if (found !== null && (name === null || found.eventSeq < name.eventSeq)) name = found
    }

    out.push({
      key: `construct_${first.x}_${first.y}`,
      anchor,
      participants: [...new Set(window.flatMap((g) => g.participants))].sort(),
      firstTick: first.tick,
      gatherings: window.map((g) => ({ tick: g.tick, participants: g.participants })),
      signals: {
        expressive: presences.filter((p) => p.ev.type === 'agent_expressed').length,
        offerings: presences.filter((p) => p.ev.type === 'item_taken').length,
        sharedTokens: [...tokens.entries()].filter(([, who]) => who.size > 1).map(([w]) => w).sort(),
        deferredTo: loudest !== undefined && turns.size > 1 && loudest[1] > 1 ? loudest[0] : null,
      },
      name,
    })
  }
  return out
}

// The type ids are the vocabulary the model must answer with, so every one of them is on the
// page in front of it (canon-vocabulary law). None of these words ever reaches an agent.
export const CONSTRUCT_TYPE_INSTRUCTION = `You read the ops record of a town nobody in it can hear you discussing. Some bodies keep coming back to the same ground. For each one below, say which kind of thing it is, using exactly one of these ids and no other word:
festival — a recurring occasion of celebration, dancing, feasting or song
faith — a recurring occasion of prayer, mourning, offering or reverence
council — a recurring occasion of talk where a decision is being reached, often with one voice deferred to
market — a recurring occasion of goods changing hands
custom — a recurring occasion that is plainly none of the four above; use it freely, the list is not the world
Answer for every key you are given and invent no keys. Name the kind only. Never a name for the thing itself: a name comes out of their own mouths or not at all.`

const ClassificationSchema = z.object({
  rulings: z.array(z.object({ key: z.string().min(1), type: z.string().min(1) }).strict()),
}).strict()

function renderCandidates(candidates: Candidate[]): string {
  return candidates.map((c) => {
    const s = c.signals
    return [
      `- ${c.key}`,
      `  bodies: ${c.participants.length}`,
      `  times they came back: ${c.gatherings.length}`,
      `  acts done for their own sake: ${s.expressive}`,
      `  things left or taken there: ${s.offerings}`,
      `  words they share: ${s.sharedTokens.slice(0, 12).join(', ') || 'none'}`,
      `  one voice answered more than the others: ${s.deferredTo === null ? 'no' : 'yes'}`,
    ].join('\n')
  }).join('\n')
}

// One call for the whole pass, and none at all when there is nothing to classify. A type the
// taxonomy does not have — or one the world has switched off — falls back to `custom`.
export async function classifyCandidates(
  candidates: Candidate[], llm: LlmClient, config: SimConfig,
): Promise<Map<string, ConstructType>> {
  const out = new Map<string, ConstructType>()
  if (candidates.length === 0) return out
  const allowed = new Set(CONSTRUCT_TYPES.filter((t) => (config.constructs.types as Record<string, boolean>)[t]))
  const r = await llm.object({
    schema: ClassificationSchema,
    system: CONSTRUCT_TYPE_INSTRUCTION,
    messages: [{ role: 'user', content: renderCandidates(candidates) }],
  })
  const rulings = r.value.rulings
  for (const c of candidates) {
    const said = rulings.find((x) => x.key === c.key)?.type
    const type = said !== undefined && allowed.has(said as ConstructType) ? said as ConstructType : 'custom'
    if (allowed.has(type)) out.set(c.key, type)
  }
  return out
}

// The ops-plane read of the world's laws (G5): the recognizer is an entry point into
// config-derived behaviour, so it derives its own from the same whitelist the fold uses.
export function lawsFromEvents(events: SimEvent[]): Record<string, unknown> {
  const laws: Record<string, unknown> = {}
  for (const ev of events) {
    if (ev.type !== 'config_changed') continue
    const p = ev.payload as { path?: unknown; value?: unknown } | null
    if (typeof p?.path !== 'string') continue
    const schema = TOGGLABLE_PATHS[p.path]
    const parsed = schema?.safeParse(p.value)
    if (parsed?.success === true) laws[p.path] = parsed.data
  }
  return laws
}

export type ConstructPassDeps = {
  events: SimEvent[]
  baseConfig: SimConfig
  store: ConstructStore
  llm: LlmClient
  laws?: Record<string, unknown>
}

// The daily pass: heuristics, then one classification call, then the registry. Idempotent —
// a second pass over the same days recognizes nothing twice.
export async function runConstructPass(deps: ConstructPassDeps): Promise<Construct[]> {
  const config = effectiveConfig(deps.baseConfig, deps.laws ?? lawsFromEvents(deps.events))
  if (!config.constructs.enabled) return []
  const candidates = detectCandidates(deps.events, config)
  const types = await classifyCandidates(candidates, deps.llm, config)

  const out: Construct[] = []
  for (const c of candidates) {
    const type = types.get(c.key)
    if (type === undefined) continue
    const known = deps.store.byId(c.key)
    const row: Construct = {
      id: c.key,
      type: known?.type ?? type,
      name: c.name?.name ?? known?.name ?? null,
      nameProvenance: c.name === null
        ? known?.nameProvenance ?? null
        : { eventSeq: c.name.eventSeq, quote: c.name.quote, byId: c.name.byId },
      anchor: c.anchor,
      participants: c.participants,
      firstTick: c.firstTick,
      recurrences: c.gatherings.slice(1).map((g) => ({ tick: g.tick, participants: g.participants })),
    }
    deps.store.upsert(row)
    if (known === null) {
      deps.store.record('construct_recognized', row.id, row.firstTick, {
        type: row.type, anchor: row.anchor, participants: row.participants,
      })
      for (const r of row.recurrences) {
        deps.store.record('construct_recurred', row.id, r.tick, { participants: r.participants })
      }
      if (row.nameProvenance !== null) {
        deps.store.record('construct_named', row.id, row.firstTick, {
          name: row.name, provenance: row.nameProvenance,
        })
      }
    } else if (known.nameProvenance === null && row.nameProvenance !== null) {
      deps.store.record('construct_named', row.id, row.firstTick, {
        name: row.name, provenance: row.nameProvenance,
      })
    }
    out.push(row)
  }
  return out
}
