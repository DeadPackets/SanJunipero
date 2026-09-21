import { z } from 'zod'
import type { LlmClient } from '@sj/llm'
import { effectiveConfig, TOGGLABLE_PATHS } from '@sj/engine'
import {
  CONSTRUCT_TYPES,
  MINUTES_PER_DAY,
  assertQuotedName,
  type ConstructKind,
  type QuotedName,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import type { ConstructStore } from './constructStore.js'

// The recognizer names a TYPE; the name itself is the town's, quoted from a mouth or left null.
// Nothing here may reach a prompt, a perception packet, world state or the hash.

export const ConstructSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(CONSTRUCT_TYPES),
    name: z.string().min(1).nullable(),
    nameProvenance: z
      .object({
        name: z.string().min(1),
        sourceKind: z.enum(['speech', 'inscription']),
        eventSeq: z.number().int().nonnegative(),
        quote: z.string().min(1),
        byId: z.string().min(1),
      })
      .strict()
      .nullable(),
    anchor: z
      .union([z.object({ x: z.number().int(), y: z.number().int() }).strict(), z.string().min(1)])
      .nullable(),
    participants: z.array(z.string().min(1)),
    firstTick: z.number().int().nonnegative(),
    recurrences: z.array(
      z
        .object({
          tick: z.number().int().nonnegative(),
          participants: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict()
export type Construct = z.infer<typeof ConstructSchema>

export type ConstructOpsType = 'construct_recognized' | 'construct_named' | 'construct_recurred'
export type ConstructOpsEvent = {
  type: ConstructOpsType
  constructId: string
  tick: number
  payload: unknown
}

// How near two bodies must be to be at the same thing. A module const, not a dial: G11b tunes
// the world by its genesis, not by a config row nobody would ever turn.
const ANCHOR_CELL = 4

export type Gathering = { tick: number; participants: string[] }
export type CandidateName = QuotedName
export type Candidate = {
  key: string
  anchor: { x: number; y: number } | string
  use: Use
  participants: string[]
  firstTick: number
  gatherings: Gathering[]
  // Evidence, never a gate: recurrence at a place is what makes a candidate, and these are
  // what let a classifier tell a market from a council.
  signals: {
    expressive: number
    offerings: number
    sharedTokens: string[]
    deferredTo: string | null
  }
  name: CandidateName | null
}

type Presence = { tick: number; agentId: string; x: number; y: number; ev: SimEvent }
type Position = { agentId: string; x: number; y: number; room: string | null }
type Use = 'expressive' | 'goods' | 'gathering'
type Occasion = {
  tick: number
  x: number
  y: number
  room: string | null
  participants: Set<string>
  presences: Presence[]
  uses: Set<Use>
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= ANCHOR_CELL

const centroid = (ps: { x: number; y: number }[]): { x: number; y: number } => ({
  x: Math.round(ps.reduce((t, p) => t + p.x, 0) / ps.length),
  y: Math.round(ps.reduce((t, p) => t + p.y, 0) / ps.length),
})

// Greedy clustering seeded in the given order, so the same input always yields the same
// groups. A grid would put two bodies standing side by side in different cells.
function clusterBy<T extends { x: number; y: number }>(items: T[]): T[][] {
  const clusters: { seed: { x: number; y: number }; items: T[] }[] = []
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
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'we',
  'i',
  'you',
  'it',
  'is',
  'are',
  'was',
  'were',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'this',
  'that',
  'now',
  'then',
  'here',
  'there',
  'call',
  'again',
])

// A name arrives only out of a mouth. These are the shapes a town uses to give one; the whole
// utterance is kept as the quote, so the name can always be checked back against it verbatim.
const NAME_PATTERNS: readonly RegExp[] = [
  /\bwe call (?:it|this|them|these|ourselves) (?:the )?([\p{Lu}][\p{L}' -]{1,39})/u,
  /\bcall(?:ed)? it (?:the )?([\p{Lu}][\p{L}' -]{1,39})/u,
  /\bthis is (?:the )?([\p{Lu}][\p{L}' -]{1,39})/u,
]

// A custom is never named after a person, and "this is Tariq" is an introduction, not a naming.
const namesABody = (found: string, cast: ReadonlySet<string>): boolean =>
  found
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .some((word) => cast.has(word))

function nameIn(ev: SimEvent, cast: ReadonlySet<string>): QuotedName | null {
  const p = ev.payload as { agentId?: unknown; text?: unknown } | null
  if (typeof p?.text !== 'string' || typeof p.agentId !== 'string') return null
  const source = { sourceKind: 'speech' as const, text: p.text, eventSeq: ev.seq, byId: p.agentId }
  for (const re of NAME_PATTERNS) {
    const found = re
      .exec(p.text)?.[1]
      ?.replace(/[.,!?;:]+$/, '')
      .trim()
    if (found === undefined || found.length < 2) continue
    if (namesABody(found, cast)) continue
    // Verbatim or nothing, through the one enforcement point of the naming law (G9).
    const quoted = assertQuotedName(found, [source])
    if (quoted !== null) return quoted
  }
  return null
}

const sameSite = (a: Occasion, b: { x: number; y: number; room: string | null }): boolean =>
  a.room === b.room && (a.room !== null || near(a, b))

const useOf = (ev: SimEvent): Use =>
  ev.type === 'agent_expressed'
    ? 'expressive'
    : ev.type === 'item_moved' || ev.type === 'item_taken'
      ? 'goods'
      : 'gathering'

// Each continuous overlap is one occasion. A day boundary cannot split it, and three bodies
// visiting the same tile at different hours cannot create it.
export function detectCandidates(events: SimEvent[], config: SimConfig): Candidate[] {
  const cfg = config.constructs
  if (!cfg.enabled) return []
  const positions = new Map<string, Position>()
  const completed: Occasion[] = []
  let active: Occasion[] = []
  const scenes = new Map<string, { occasion: Occasion; owned: boolean }>()
  const cast = new Set<string>()
  for (const ev of [...events].sort((a, b) => a.tick - b.tick || a.seq - b.seq)) {
    const p = ev.payload as Record<string, unknown> | null
    if (p === null) continue
    const id =
      ev.type === 'agent_spawned' || ev.type === 'agent_moved'
        ? p.id
        : ev.type === 'item_taken'
          ? p.takerId
          : p.agentId
    if (typeof id === 'string') cast.add(id.toLowerCase())
    if ((ev.type === 'agent_spawned' || ev.type === 'agent_moved') && typeof id === 'string') {
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        positions.set(id, { agentId: id, x: p.x, y: p.y, room: positions.get(id)?.room ?? null })
      }
    } else if (
      ev.type === 'agent_entered' &&
      typeof id === 'string' &&
      typeof p.structureId === 'string'
    ) {
      const was = positions.get(id)
      if (was !== undefined) positions.set(id, { ...was, room: p.structureId })
    } else if (ev.type === 'agent_exited' && typeof id === 'string') {
      const was = positions.get(id)
      if (was !== undefined) positions.set(id, { ...was, room: null })
    } else if (ev.type === 'agent_departed' && typeof id === 'string') positions.delete(id)

    const groups: Position[][] = []
    const outdoors = [...positions.values()].filter((body) => body.room === null)
    groups.push(...clusterBy(outdoors))
    const rooms = new Map<string, Position[]>()
    for (const body of positions.values()) {
      if (body.room === null) continue
      const room = rooms.get(body.room) ?? []
      room.push(body)
      rooms.set(body.room, room)
    }
    groups.push(...rooms.values())
    const next: Occasion[] = []
    for (const group of groups) {
      if (group.length < cfg.minParticipants) continue
      const at = centroid(group)
      const room = group[0]!.room
      const occasion = active.find(
        (held) => !next.includes(held) && sameSite(held, { ...at, room }),
      ) ?? {
        tick: ev.tick,
        ...at,
        room,
        participants: new Set<string>(),
        presences: [],
        uses: new Set<Use>(),
      }
      for (const body of group) occasion.participants.add(body.agentId)
      if (
        typeof id === 'string' &&
        group.some((body) => body.agentId === id) &&
        ['agent_spoke', 'agent_expressed', 'item_taken'].includes(ev.type)
      ) {
        const body = positions.get(id)!
        occasion.presences.push({ tick: ev.tick, agentId: id, x: body.x, y: body.y, ev })
        occasion.uses.add(useOf(ev))
      }
      next.push(occasion)
    }
    for (const held of active) if (!next.includes(held)) completed.push(held)
    active = next
    if (ev.type === 'scene_opened' && typeof p.id === 'string' && Array.isArray(p.participants)) {
      const participants = p.participants.filter(
        (person): person is string => typeof person === 'string',
      )
      if (participants.length >= cfg.minParticipants) {
        const positionsOfCast = participants.flatMap((person) => {
          const body = positions.get(person)
          return body === undefined ? [] : [body]
        })
        const room = positionsOfCast[0]?.room ?? null
        const at = positionsOfCast.length === 0 ? { x: 0, y: 0 } : centroid(positionsOfCast)
        const occasion: Occasion = {
          tick: ev.tick,
          ...at,
          room,
          participants: new Set<string>(),
          presences: [],
          uses: new Set<Use>(),
        }
        for (const person of participants) occasion.participants.add(person)
        occasion.uses.add('gathering')
        scenes.set(p.id, { occasion, owned: true })
      }
    } else if (ev.type === 'scene_line' && typeof p.id === 'string') {
      const scene = scenes.get(p.id)
      if (scene !== undefined && typeof p.agentId === 'string') {
        const body = positions.get(p.agentId)
        scene.occasion.presences.push({
          tick: ev.tick,
          agentId: p.agentId,
          x: body?.x ?? scene.occasion.x,
          y: body?.y ?? scene.occasion.y,
          ev,
        })
      }
    } else if (ev.type === 'scene_closed' && typeof p.id === 'string') {
      const scene = scenes.get(p.id)
      if (scene?.owned === true) completed.push(scene.occasion)
      scenes.delete(p.id)
    }
  }
  completed.push(...active)
  for (const scene of scenes.values()) if (scene.owned) completed.push(scene.occasion)

  const out: Candidate[] = []
  const occasions = completed.filter((o) => o.presences.length > 0)
  const sites: { room: string | null; use: Use; x: number; y: number; occasions: Occasion[] }[] = []
  for (const occasion of occasions) {
    for (const use of occasion.uses) {
      const site = sites.find(
        (held) =>
          held.room === occasion.room &&
          held.use === use &&
          (held.room !== null || near(held, occasion)),
      )
      if (site === undefined)
        sites.push({
          room: occasion.room,
          use,
          x: occasion.x,
          y: occasion.y,
          occasions: [occasion],
        })
      else site.occasions.push(occasion)
    }
  }
  for (const site of sites) {
    const all = site.occasions
    const first = all[0]!
    const span = cfg.windowDays * MINUTES_PER_DAY
    const dense = all.some(
      (g) =>
        all.filter((h) => h.tick >= g.tick && h.tick - g.tick <= span).length - 1 >=
        cfg.minRecurrences,
    )
    if (!dense) continue

    const presences = all.flatMap((g) => g.presences)
    const speech = presences.filter((p) => p.ev.type === 'agent_spoke')
    const tokens = new Map<string, Set<string>>()
    for (const s of speech) {
      const text = (s.ev.payload as { text?: string }).text ?? ''
      for (const raw of text.toLowerCase().split(/[^\p{L}']+/u)) {
        if (raw.length < 3 || STOPWORDS.has(raw)) continue
        const speakers = tokens.get(raw) ?? new Set<string>()
        speakers.add(s.agentId)
        tokens.set(raw, speakers)
      }
    }
    const anchor = site.room ?? centroid(all)

    let name: CandidateName | null = null
    for (const s of speech) {
      const found = nameIn(s.ev, cast)
      if (found !== null && (name === null || found.eventSeq < name.eventSeq)) name = found
    }

    out.push({
      key:
        site.room === null
          ? `construct_${first.x}_${first.y}_${site.use}`
          : `construct_room_${site.room}_${site.use}`,
      anchor,
      use: site.use,
      participants: [...new Set(all.flatMap((g) => [...g.participants]))].sort(),
      firstTick: first.tick,
      gatherings: all.map((g) => ({ tick: g.tick, participants: [...g.participants].sort() })),
      signals: {
        expressive: presences.filter((p) => p.ev.type === 'agent_expressed').length,
        offerings: presences.filter((p) => p.ev.type === 'item_taken').length,
        sharedTokens: [...tokens.entries()]
          .filter(([, who]) => who.size > 1)
          .map(([w]) => w)
          .sort(),
        deferredTo: null,
      },
      name,
    })
  }
  return out
}

// The type ids are the vocabulary the model must answer with, so every one of them is on the
// page in front of it (canon-vocabulary law). None of these words ever reaches an agent.
export const CONSTRUCT_TYPE_INSTRUCTION = `You read the ops record of a town nobody in it can hear you discussing. Some bodies keep coming back to the same ground. For each one below, say which kind of thing it is, using exactly one of these ids and no other word:
festival: a recurring occasion of celebration, dancing, feasting or song
faith: a recurring occasion of prayer, mourning, offering or reverence
council: a recurring occasion of talk where a decision is being reached, often with one voice deferred to
market: a recurring occasion of goods changing hands
custom: a recurring occasion that is plainly none of the four above. Use it freely, the list is not the world
Answer for every key you are given and invent no keys. Name the kind only. Never a name for the thing itself: a name comes out of their own mouths or not at all.`

export const ClassificationSchema = z
  .object({
    rulings: z.array(z.object({ key: z.string().min(1), type: z.string().min(1) }).strict()),
  })
  .strict()

function renderCandidates(candidates: Candidate[]): string {
  return candidates
    .map((c) => {
      const s = c.signals
      return [
        `- ${c.key}`,
        `  bodies: ${c.participants.length}`,
        `  times they came back: ${c.gatherings.length}`,
        `  observed use: ${c.use}`,
        `  acts done for their own sake: ${s.expressive}`,
        `  things left or taken there: ${s.offerings}`,
        `  words they share: ${s.sharedTokens.slice(0, 12).join(', ') || 'none'}`,
        `  one voice answered more than the others: ${s.deferredTo === null ? 'no' : 'yes'}`,
      ].join('\n')
    })
    .join('\n')
}

// One call for the whole pass, and none at all when there is nothing to classify. A type the
// taxonomy does not have — or one the world has switched off — falls back to `custom`.
export async function classifyCandidates(
  candidates: Candidate[],
  llm: LlmClient,
  config: SimConfig,
): Promise<Map<string, ConstructKind>> {
  const out = new Map<string, ConstructKind>()
  if (candidates.length === 0) return out
  const allowed = new Set(CONSTRUCT_TYPES.filter((t) => config.constructs.types[t]))
  const r = await llm.object({
    schema: ClassificationSchema,
    system: CONSTRUCT_TYPE_INSTRUCTION,
    messages: [{ role: 'user', content: renderCandidates(candidates) }],
  })
  const rulings = r.value.rulings
  for (const c of candidates) {
    const said = rulings.find((x) => x.key === c.key)?.type
    const type = CONSTRUCT_TYPES.find((t) => t === said && allowed.has(t)) ?? 'custom'
    if (allowed.has(type)) out.set(c.key, type)
  }
  return out
}

/** How many named things the town can hold in front of it at once. Oldest first, so a name
 *  already on the page never moves and the block it sits in stays cached. */
export const NAMED_CUSTOMS_SHOWN = 6

/** The only thing about a construct a mind may ever be told: the name the town gave it, out of
 *  its own mouth. The glass stops OUR words reaching a mind, and a name quoted verbatim from a
 *  mind's own speech is the town's word already — `council` is a word a town will use. */
/** How many separate days a gathering has to come back on before the town is told it has a
 *  habit, and how many before that habit is called a tradition. Days, not gatherings: three
 *  market mornings in one day are one morning. */
export const HABIT_DAYS = 3
export const TRADITION_DAYS = 7
export const HABITS_SHOWN = 4

const daysOf = (c: Construct): number =>
  new Set(
    [c.firstTick, ...c.recurrences.map((r) => r.tick)].map((t) => Math.floor(t / MINUTES_PER_DAY)),
  ).size

/** What the town keeps doing, said to every mind in plain words: how many of them, where, and on
 *  how many days. What kind of thing the recognizer decided it is stays behind the glass; a name
 *  is said only when the town gave one. Oldest habit first. */
export function habitLines(constructs: readonly Construct[]): string[] {
  return constructs
    .map((c) => ({ c, days: daysOf(c) }))
    .filter(({ days }) => days >= HABIT_DAYS)
    .sort((a, b) => a.c.firstTick - b.c.firstTick || (a.c.id < b.c.id ? -1 : 1))
    .slice(0, HABITS_SHOWN)
    .map(({ c, days }) => {
      const people = new Set([...c.participants, ...c.recurrences.flatMap((r) => r.participants)])
      const where =
        c.anchor === null
          ? ''
          : typeof c.anchor === 'string'
            ? ` at the ${c.anchor}`
            : ` at the same spot near (${c.anchor.x}, ${c.anchor.y})`
      const named =
        c.name === null ? 'Nobody has given it a name yet.' : `You call it the ${c.name}.`
      const standing = days >= TRADITION_DAYS ? 'It is a tradition by now.' : ''
      return [
        `${people.size} of you have gathered${where} on ${days} different days.`,
        named,
        standing,
      ]
        .filter((s) => s.length > 0)
        .join(' ')
    })
}

export function namedCustoms(constructs: readonly Construct[]): string[] {
  return constructs
    .filter((c) => c.nameProvenance?.sourceKind === 'speech')
    .sort((a, b) => a.firstTick - b.firstTick || (a.id < b.id ? -1 : 1))
    .flatMap((c) => (c.name === null ? [] : [c.name]))
    .slice(0, NAMED_CUSTOMS_SHOWN)
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
  laws?: Record<string, unknown> | undefined
}

// The daily pass: heuristics, then one classification call, then the registry. Idempotent —
// a second pass over the same days recognizes nothing twice.
export async function runConstructPass(deps: ConstructPassDeps): Promise<Construct[]> {
  const config = effectiveConfig(deps.baseConfig, deps.laws ?? lawsFromEvents(deps.events))
  if (!config.constructs.enabled) return []
  // A key is the earliest gathering still in the window, and the window rolls: the same ground
  // keeps the id it was first registered under rather than being recognized a second time.
  const registry = deps.store.all()
  const candidates = detectCandidates(deps.events, config).map((c) => {
    const seen = registry.find(
      (r) =>
        r.id === c.key ||
        (r.id.endsWith(`_${c.use}`) &&
          ((typeof r.anchor === 'string' && r.anchor === c.anchor) ||
            (typeof r.anchor === 'object' &&
              r.anchor !== null &&
              typeof c.anchor === 'object' &&
              near(r.anchor, c.anchor)))),
    )
    return seen === undefined ? c : { ...c, key: seen.id }
  })
  // A site the registry has already typed is not asked about again: the answer for one is
  // thrown away, and the prompt grows a block per site.
  const untyped = candidates.filter((c) => deps.store.byId(c.key) === null)
  const types = await classifyCandidates(untyped, deps.llm, config)

  const out: Construct[] = []
  for (const c of candidates) {
    const known = deps.store.byId(c.key)
    const type = known?.type ?? types.get(c.key)
    if (type === undefined) continue
    const row: Construct = {
      id: c.key,
      type,
      name: c.name?.name ?? known?.name ?? null,
      nameProvenance: c.name ?? known?.nameProvenance ?? null,
      anchor: c.anchor,
      participants: c.participants,
      firstTick: c.firstTick,
      recurrences: c.gatherings
        .slice(1)
        .map((g) => ({ tick: g.tick, participants: g.participants })),
    }
    deps.store.upsert(row)
    if (known === null) {
      deps.store.record('construct_recognized', row.id, row.firstTick, {
        type: row.type,
        anchor: row.anchor,
        participants: row.participants,
      })
    }
    const already = new Set((known?.recurrences ?? []).map((r) => r.tick))
    for (const r of row.recurrences) {
      if (already.has(r.tick)) continue
      deps.store.record('construct_recurred', row.id, r.tick, { participants: r.participants })
    }
    if (row.nameProvenance !== null && (known?.nameProvenance ?? null) === null) {
      deps.store.record('construct_named', row.id, row.firstTick, {
        name: row.name,
        provenance: row.nameProvenance,
      })
    }
    out.push(row)
  }
  return out
}
