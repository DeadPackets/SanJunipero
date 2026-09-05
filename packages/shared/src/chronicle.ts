import { z } from 'zod'
import { kindWords } from './places.js'
import { verbPhrase } from './verbs.js'
import type { SimEvent } from './events.js'

// What the town would remember. The weight is editorial, not a score the town can win:
// it decides what surfaces in a curated feed, and nothing else reads it.
export const CHRONICLE_WEIGHTS: Record<string, number> = {
  agent_died: 20,
  // §3: under a death and over a birth. A person dying is the peak of a life simulation; what
  // that life can now DO is second, and it is the only entry here that is permanent.
  discovery_made: 19,
  agent_born: 18,
  law_ratified: 17,
  partnership_formed: 16,
  world_grown: 15,
  partnership_dissolved: 15,
  // The only entry made of what people said to each other: the summary IS the line.
  scene_closed: 14,
  law_repealed: 13,
  grave_placed: 12,
  invitation_accepted: 12,
  agent_spawned: 12,
  structure_completed: 10,
  invitation_refused: 10,
  fire_ignited: 9,
  fire_extinguished: 9,
  agent_harmed: 8,
  agent_afflicted: 8,
  invited: 8,
  law_broken: 8,
  fire_spread: 7,
  law_proposed: 6,
  structure_inscribed: 6,
  affliction_recovered: 6,
  affliction_worsened: 5,
  agent_tended: 5,
  fauna_killed: 5,
  mystery_event: 4,
  tile_changed: 4,
  // A shared roof is a roof and nothing more now: the acts two people choose say the rest.
  co_slept: 3,
  agent_expressed: 2,
}

export const CHRONICLE_ICONS: Record<string, string> = {
  agent_died: 'cross',
  scene_closed: 'spark',
  agent_spawned: 'star',
  discovery_made: 'key',
  agent_born: 'spark',
  law_proposed: 'quill',
  law_ratified: 'quill',
  law_broken: 'flame',
  law_repealed: 'quill',
  world_grown: 'star',
  grave_placed: 'cross',
  partnership_formed: 'heart',
  partnership_dissolved: 'flame',
  invitation_accepted: 'heart',
  invitation_refused: 'quill',
  invited: 'heart',
  co_slept: 'house',
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
  // A chase re-aims at whoever it follows every tick it runs: the walk is the story, not the
  // legs correcting themselves inside it.
  'walk_reaimed',
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
  'traffic_decayed',
  'places_seen',
  // The body's own bookkeeping, and the ledger's.
  'tick_advanced',
  'agent_moved',
  'needs_changed',
  'hp_changed',
  'skill_gained',
  'agent_woke',
  'agent_slept',
  'agent_entered',
  'agent_exited',
  'agent_aged',
  'agent_collapsed',
  'agent_spoke',
  'agent_conceived',
  // A scene reaches the chronicle as the summary it closed on; the bookkeeping around it does not.
  'scene_opened',
  'scene_line',
  // The mind already remembers letting go; the feed does not need to watch it happen.
  'tie_let_go',
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
  // What a minted verb leaves behind is the town's to read off the thing, not the record's.
  'marked',
  'place_named',
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
    /** Who the line is about, so a replay of it can frame them. Absent from an older gateway. */
    agentIds: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type ChronicleEntry = z.infer<typeof ChronicleEntrySchema>

/** A shot frames people, not a crowd; past this the camera is looking at the town anyway. */
export const CHRONICLE_CAST_MAX = 4

/** Who a chronicle line is about. Read off the payload's own ids and kept only where one names
 *  a person, so a new event type is covered without a second list of payload keys to maintain. */
export function chronicleCast(ev: SimEvent, isAgent: (id: string) => boolean): string[] {
  const out: string[] = []
  const p = ev.payload as Record<string, unknown>
  // A scene keeps its cast in one list; every other line names its people a key at a time.
  const named = Array.isArray(p.participants) ? p.participants : Object.values(p)
  for (const v of named) {
    if (typeof v !== 'string' || out.includes(v) || !isAgent(v)) continue
    out.push(v)
    if (out.length === CHRONICLE_CAST_MAX) break
  }
  return out
}

export const ChronicleResponseSchema = z.object({ entries: z.array(ChronicleEntrySchema) }).strict()
export type ChronicleResponse = z.infer<typeof ChronicleResponseSchema>

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
  const beast = kindWords(kind)
  return farBank ? `a ${beast} ${FAR_BANK_PHRASE}` : `a ${beast}`
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

// Who was standing close enough to see it, in words. Capped like a cast is: a line that names
// eight people is a list, not a sentence.
function witnessWords(witnesses: unknown, look: ChronicleLookup): string {
  if (!Array.isArray(witnesses)) return ''
  const ids = witnesses.filter((w): w is string => typeof w === 'string')
  const named = ids.slice(0, CHRONICLE_CAST_MAX).map((id) => look.agentName(id))
  if (ids.length > CHRONICLE_CAST_MAX) named.push('others')
  const last = named.pop()
  if (last === undefined) return ''
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`
}

// What a passer-by would have seen of an invitation. A bedding is asked and refused where
// nobody is watching, so only the shut door reaches the paper; and a proposal accepted is the
// partnership line one breath later, which says it better than the yes does.
function invitationLine(type: string, verb: string, asker: string, invitee: string): string | null {
  if (type === 'invited') {
    if (verb === 'court') return `${asker} asked ${invitee} to walk out.`
    return verb === 'propose' ? `${asker} asked ${invitee} to be their partner.` : null
  }
  if (type === 'invitation_accepted') {
    if (verb === 'court') return `${invitee} said yes to ${asker}.`
    return verb === 'lie_with' ? `${asker} and ${invitee} went in and shut the door.` : null
  }
  if (verb === 'court') return `${invitee} would not walk out with ${asker}.`
  return verb === 'propose' ? `${invitee} refused ${asker} a life together.` : null
}

/** A reason is a thing somebody said, not a paragraph; past this the feed is a transcript. */
export const SAYING_MAX = 120

function clipSaying(saying: string): string {
  const said = saying.trim()
  return said.length <= SAYING_MAX ? said : `${said.slice(0, SAYING_MAX - 1).trimEnd()}…`
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
      const beast = str(p.kind) === '' ? 'an animal' : `a ${kindWords(str(p.kind))}`
      return who === null
        ? `A ${kindWords(str(p.kind))} was found dead.`
        : `${who} brought down ${beast}.`
    }
    case 'agent_expressed': {
      const who = look.agentName(str(p.agentId))
      // The coined word said as words: `recipe:` is the town's "make", and the namespace and the
      // separators under it are ours, never theirs.
      const verb = str(p.verb) === '' ? '' : verbPhrase(str(p.verb))
      const witness = p.sense === 'sound' ? 'was heard' : 'was seen'
      const forWhom = typeof p.targetId === 'string' ? ` for ${look.agentName(p.targetId)}` : ''
      return verb === '' ? null : `${who} ${witness} to ${verb}${forWhom}.`
    }
    // Who, what, and the reason in the words it was said in. The `intent` — the free text the
    // mind wrote to the court — stays out; the archive keeps that (gateway /api/discoveries).
    case 'discovery_made': {
      const name = str(p.name)
      const kind = str(p.kind)
      if (name === '' || (kind !== 'craft' && kind !== 'word')) return null
      const who = look.agentName(str(p.byId))
      const line =
        kind === 'word'
          ? `${who} gave the town a word for it — ${name}.`
          : `${who} found the way of it — ${name}.`
      const saying = clipSaying(str(p.saying))
      return saying === '' ? line : `${line} “${saying}”`
    }
    case 'agent_born':
      return `${str(p.name)} was born.`
    // The founding is nobody's arrival: the town began with them. Anybody after it walked in.
    case 'agent_spawned':
      return ev.tick === 0 ? null : `${look.agentName(str(p.id))} came to the town.`
    case 'scene_closed': {
      const summary = str(p.summary).trim()
      return summary === '' ? null : summary
    }
    case 'co_slept':
      return `${look.agentName(str(p.aId))} and ${look.agentName(str(p.bId))} kept house together.`
    case 'invited':
    case 'invitation_accepted':
    case 'invitation_refused':
      return invitationLine(
        ev.type,
        str(p.verb),
        look.agentName(str(p.byId)),
        look.agentName(str(p.agentId)),
      )
    case 'partnership_formed':
      return `${look.agentName(str(p.aId))} and ${look.agentName(str(p.bId))} are partners now.`
    case 'partnership_dissolved': {
      const leaver = str(p.byId)
      const left = leaver === str(p.aId) ? str(p.bId) : str(p.aId)
      return `${look.agentName(leaver)} has left ${look.agentName(left)}.`
    }
    // A rule reaches the paper in the words the town used for it, quoted. The id it is filed
    // under is ours, and the breach names the deed rather than the clause it fell under.
    case 'law_proposed':
      return `${look.agentName(str(p.agentId))} put a rule to the room: “${str(p.text)}”`
    case 'law_ratified':
      return `The town agreed: “${str(p.text)}”`
    case 'law_repealed':
      return `The town let a rule go: “${str(p.text)}”`
    case 'law_broken': {
      const who = look.agentName(str(p.agentId))
      const saw = witnessWords(p.witnesses, look)
      return saw === ''
        ? `${who} did what the town agreed against.`
        : `${who} did what the town agreed against, and ${saw} saw.`
    }
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
