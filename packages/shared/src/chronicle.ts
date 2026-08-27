import { z } from 'zod'
import type { SimEvent } from './events.js'

// What the town would remember. The weight is editorial, not a score the town can win:
// it decides what surfaces in a curated feed, and nothing else reads it.
export const CHRONICLE_WEIGHTS: Record<string, number> = {
  agent_died: 20,
  // §3: under a death and over a birth. A person dying is the peak of a life simulation; what
  // that life can now DO is second, and it is the only entry here that is permanent.
  discovery_made: 19,
  agent_born: 18,
  world_grown: 15,
  grave_placed: 12,
  co_slept: 12,
  structure_completed: 10,
  fire_ignited: 9,
  fire_extinguished: 9,
  agent_harmed: 8,
  agent_afflicted: 8,
  fire_spread: 7,
  structure_inscribed: 6,
  affliction_recovered: 6,
  affliction_worsened: 5,
  agent_tended: 5,
  fauna_killed: 5,
  mystery_event: 4,
  tile_changed: 4,
  agent_expressed: 2,
}

export const CHRONICLE_ICONS: Record<string, string> = {
  agent_died: 'cross',
  discovery_made: 'key',
  agent_born: 'spark',
  world_grown: 'star',
  grave_placed: 'cross',
  co_slept: 'heart',
  structure_completed: 'house',
  fire_ignited: 'flame',
  fire_extinguished: 'flame',
  agent_harmed: 'flame',
  agent_afflicted: 'leaf',
  fire_spread: 'flame',
  structure_inscribed: 'quill',
  affliction_recovered: 'spark',
  affliction_worsened: 'leaf',
  agent_tended: 'heart',
  fauna_killed: 'spark',
  mystery_event: 'star',
  tile_changed: 'road',
  agent_expressed: 'spark',
}

// Every type the fold knows is either weighted above or named here on purpose, so a future event
// cannot be silently dropped. Routine bodily and housekeeping acts stay out of the feed.
export const NOT_CHRONICLED: ReadonlySet<string> = new Set([
  // The quiet acts, named one by one (addendum §12).
  'agent_drank',
  'item_filled',
  'item_equipped',
  'item_unequipped',
  'item_lit',
  'item_snuffed',
  'item_burned_out',
  'structure_fueled',
  'fauna_spawned',
  'fauna_moved',
  'fauna_stock_changed',
  'forageable_spawned',
  'forageable_stock_changed',
  'forageable_depleted',
  'forageable_regrown',
  'thirst_changed',
  'traffic_decayed',
  // The body's own bookkeeping, and the ledger's.
  'tick_advanced',
  'agent_moved',
  'need_changed',
  'hp_changed',
  'skill_gained',
  'agent_woke',
  'agent_slept',
  'agent_entered',
  'agent_exited',
  'agent_aged',
  'agent_collapsed',
  'agent_spawned',
  'agent_spoke',
  'agent_conceived',
  // Superseded by the mortality events above, which say the same things better.
  'agent_injured',
  'agent_infected',
  'agent_fell_ill',
  'agent_recovered',
  // Work in progress, and things changing hands.
  'action_started',
  'action_progressed',
  'action_completed',
  'action_interrupted',
  'structure_planned',
  'structure_progressed',
  'structure_damaged',
  'structure_destroyed',
  'item_spawned',
  'item_moved',
  'item_spoiled',
  'item_worn',
  'item_broke',
  'item_owner_changed',
  'item_qty_changed',
  'item_text_changed',
  'item_taken',
  'crop_planted',
  'crop_grew',
  'crop_withered',
  'crop_harvested',
  'weather_changed',
  'wildlife_changed',
  'config_changed',
])

export const CHRONICLE_TYPES: readonly string[] = Object.keys(CHRONICLE_WEIGHTS)
export const CHRONICLE_FALLBACK_ICON = 'star'

// A narrator "first" enters the same feed under its own type, so a reader cannot tell the
// two sources apart and a client needs no second shape.
export const MILESTONE_TYPE = 'first'
export const MILESTONE_ICON = 'spark'

export const ChronicleEntrySchema = z
  .object({
    seq: z.number().int().positive(),
    tick: z.number().int().nonnegative(),
    type: z.string().min(1),
    icon: z.string().min(1),
    label: z.string().min(1),
  })
  .strict()
export type ChronicleEntry = z.infer<typeof ChronicleEntrySchema>

export const ChronicleResponseSchema = z.object({ entries: z.array(ChronicleEntrySchema) }).strict()
export type ChronicleResponse = z.infer<typeof ChronicleResponseSchema>

/** What `/api/chronicle/count` answers. The lens badge shows one number and used to download the
 *  whole ledger to find it — every entry over the wire and through `JSON.parse`, every 20 s. */
export const ChronicleCountSchema = z
  .object({
    count: z.number().int().nonnegative(),
    latestSeq: z.number().int().nonnegative(),
    latestTick: z.number().int().nonnegative(),
  })
  .strict()
export type ChronicleCount = z.infer<typeof ChronicleCountSchema>

export function chronicleIcon(type: string): string {
  return CHRONICLE_ICONS[type] ?? CHRONICLE_FALLBACK_ICON
}

// Everything the line needs from the world, injected, so the gateway (which can reach the engine's
// authored mystery prose) and the viewer (which cannot) produce the same sentence.
export type ChronicleLookup = {
  agentName(id: string): string
  structureKind(id: string): string
  mysteryProse(kind: string): string | null
}

// Cause is a fact and the sentence says it plainly; what it MEANT is nobody's to write down.
// The cold is named for the night that did it, never for a reading off the air.
const DEATH_SENTENCES: Readonly<Record<string, (who: string) => string>> = {
  hunger: (who) => `${who} starved.`,
  thirst: (who) => `${who} died of thirst.`,
  slain: (who) => `${who} was slain.`,
  exposure: (who) => `${who} froze.`,
  old_age: (who) => `${who} died old and full of years.`,
  injury: (who) => `${who} died of their wounds.`,
  illness: (who) => `${who} was carried off by sickness.`,
  poison: (who) => `${who} died of something they ate.`,
  fatigue: (who) => `${who} was worn out past mending.`,
}

// escalateFatigue mints fatigue after every collapse, so it is by far the commonest affliction
// a town produces — and it is not a sickness.
const AFFLICTION_SENTENCES: Readonly<Record<string, (who: string) => string>> = {
  illness: (who) => `${who} has fallen ill.`,
  poison: (who) => `${who} was poisoned.`,
  fatigue: (who) => `${who} is worn out.`,
  injury: (who) => `${who} is carrying a wound.`,
}

// Only two of the eight reasons ground changes are anybody's doing. A worn path, a seeded stump,
// a grown sapling and a tilled field are noticed by whoever looks at the ground, never announced.
function tileChangedLine(p: Record<string, unknown>, look: ChronicleLookup): string | null {
  const who = typeof p.byId === 'string' ? look.agentName(p.byId) : null
  switch (p.reason) {
    case 'paved':
      return who === null ? 'A stretch of road was laid.' : `${who} laid a stretch of road.`
    case 'channel':
      return 'A channel now carries water to the fields.'
    case 'cleared':
      return who === null ? 'A tree came down.' : `${who} felled a tree.`
    default:
      return null
  }
}

// A herd on the far bank is a thing you can see and cannot reach, and the words say so:
// visible, never available. The render and inspector read this too.
export const FAR_BANK_PHRASE = 'across the river'

export function faunaSightingLine(kind: string, farBank: boolean): string {
  return farBank ? `a ${kind} ${FAR_BANK_PHRASE}` : `a ${kind}`
}

// What a viewer reads where a name would be. The town has not named the thing, and saying so
// is the truth; the alternative is a label, and labels are ours, not theirs.
export const UNNAMED_CONSTRUCT_COPY = 'a gathering not yet named'

// No world-facing string may name the machinery behind the agent, and this regex is the point it
// is enforced. `(?!\w)` closes the boundary because a `\b` can never follow the final `.` of A.I.
export const FORBIDDEN_FRAMING =
  /\b(AI|A\.I\.|artificial intelligence|language models?|LLMs?|neural|prompts?|context windows?|tokens?|chatbots?|simulations?)(?!\w)/i

export const CONSTRUCT_CHRONICLE_WEIGHT = 16
export const CONSTRUCT_CHRONICLE_ICON = 'star'

// The observer's voice: what they do, and what they call it if they call it anything. Never
// the type, which is ours.
export function constructLine(c: { name: string | null }): string {
  return c.name === null
    ? `They have taken to gathering — ${UNNAMED_CONSTRUCT_COPY}.`
    : `They have taken to gathering, and they call it ${c.name}.`
}

// Human-framed, one sentence, never mechanics. null means "this type has no line yet",
// which is how a future event type stays harmless.
export function chronicleLine(ev: SimEvent, look: ChronicleLookup): string | null {
  const p = ev.payload as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  switch (ev.type) {
    case 'agent_died': {
      const who = look.agentName(str(p.agentId))
      const sentence = DEATH_SENTENCES[str(p.cause)]
      return sentence === undefined ? `${who} has died.` : sentence(who)
    }
    case 'agent_harmed':
      return `${look.agentName(str(p.agentId))} was hurt.`
    case 'agent_afflicted': {
      const who = look.agentName(str(p.agentId))
      // An unnamed kind is not silently a fever: escalateFatigue mints one after EVERY collapse,
      // and a town that had walked itself into the ground read as five people falling ill at once.
      return AFFLICTION_SENTENCES[str(p.kind)]?.(who) ?? `${who} is unwell.`
    }
    case 'affliction_worsened':
      return `${look.agentName(str(p.agentId))} grows worse.`
    case 'affliction_recovered':
      return `${look.agentName(str(p.agentId))} is on the mend.`
    case 'agent_tended': {
      const patient = look.agentName(str(p.agentId))
      const tender = typeof p.tenderId === 'string' ? look.agentName(p.tenderId) : null
      return tender === null ? `Someone sat with ${patient}.` : `${tender} cared for ${patient}.`
    }
    case 'grave_placed':
      return `A grave was made for ${str(p.name)}.`
    case 'fire_extinguished': {
      if (str(p.cause) !== 'doused') return null // rain and burnout are the weather, not a deed
      const who = typeof p.agentId === 'string' ? look.agentName(p.agentId) : null
      return who === null ? 'The fire was beaten back.' : `${who} beat back the fire.`
    }
    case 'tile_changed':
      return tileChangedLine(p, look)
    case 'world_grown':
      return 'The world is wider than it was.'
    case 'fauna_killed': {
      const who = typeof p.byId === 'string' ? look.agentName(p.byId) : null
      const beast = str(p.kind) === '' ? 'an animal' : `a ${str(p.kind)}`
      return who === null ? `A ${str(p.kind)} was found dead.` : `${who} brought down ${beast}.`
    }
    case 'agent_expressed': {
      const who = look.agentName(str(p.agentId))
      // The coined word, kept whole: no tense can be guessed for a verb the town invented.
      const verb = str(p.verb)
      const witness = p.sense === 'sound' ? 'was heard' : 'was seen'
      const forWhom = typeof p.targetId === 'string' ? ` for ${look.agentName(p.targetId)}` : ''
      return verb === '' ? null : `${who} ${witness} to ${verb}${forWhom}.`
    }
    // Who and what, never the words they used: the intent is free text a mind wrote. The archive
    // keeps the quote (gateway /api/discoveries), and no agent can reach the archive.
    case 'discovery_made': {
      const name = str(p.name)
      const kind = str(p.kind)
      if (name === '' || (kind !== 'craft' && kind !== 'word')) return null
      const who = look.agentName(str(p.byId))
      return kind === 'word'
        ? `${who} gave the town a word for it — ${name}.`
        : `${who} found the way of it — ${name}.`
    }
    case 'agent_born':
      return `${str(p.name)} was born.`
    case 'co_slept':
      return `${look.agentName(str(p.aId))} and ${look.agentName(str(p.bId))} kept house together.`
    case 'structure_completed':
      return `The ${look.structureKind(str(p.id))} is finished.`
    case 'fire_ignited':
      return `Fire! The ${look.structureKind(str(p.structureId))} is burning.`
    case 'fire_spread':
      return `The fire has spread to the ${look.structureKind(str(p.toId))}.`
    case 'structure_inscribed':
      return `New words carved on the ${look.structureKind(str(p.structureId))}.`
    case 'mystery_event':
      return look.mysteryProse(str(p.kind))
    default:
      return null
  }
}
