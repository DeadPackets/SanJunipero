import {
  dayPhaseFromTick,
  DAYS_PER_SEASON,
  inputName,
  MINUTES_PER_DAY,
  heardLine,
  type SimTime,
} from '@sj/shared'
import { MYSTERIES, type ForageableKind, type MakeableRoad, type Makeables } from '@sj/engine'
import { classMembers } from '@sj/shared'

// Local mirror of the engine's PerceptionPacket plus the two self-state booleans the bridge
// reconciles in. Keep the field shapes identical to @sj/engine's so the mapping stays 1:1.

type PerceptionItem = {
  id: string
  kind: string
  qty: number
  text?: string
  // Absent when the thing is unclaimed — or claimed by the one looking at it.
  ownerName?: string
  crafterMarkName?: string
  // Present only on the last day a thing can still be eaten. The engine has composed it since
  // spoilage landed; `reconcile` dropped it, so no mind was ever told its fish was going over.
  spoiling?: true
  loc:
    | { t: 'tile'; x: number; y: number }
    | { t: 'agent'; id: string }
    | { t: 'structure'; id: string }
}

// Things this agent watched happen: a taking that was not theirs, or one of the
// world's unexplained happenings close enough to see.
type PerceptionSeen =
  | { kind: 'item_taken'; takerName: string; ownerName: string; itemKind: string }
  | { kind: 'mystery'; mystery: string; prose: string }
  | { kind: 'expression'; actorName: string; verb: string; sense: 'sight' | 'sound' }

type PerceptionAgent = {
  id: string
  name: string
  x: number
  y: number
  activityVerb: string | null
  collapsed: boolean
  asleep: boolean
  // How the body is dressed, already in words. Absent on bare shoulders.
  worn?: string
  // How the body looks when it looks bad, already in words. Absent on a well one.
  condition?: string
}

type PerceptionStructure = {
  id: string
  kind: string
  // What the town calls it. Absent on a roof nobody has named; a mind is shown the name where
  // it stands, or it cannot say "meet me at the well" while standing at the well.
  name?: string
  x: number
  y: number
  w: number
  h: number
  burning: boolean
  stage: 'construction' | 'complete'
  // The tile `enter` measures against. Absent when there is no way in at all, and then the
  // prose falls back to the nearest open ground beside the wall.
  door?: { x: number; y: number }
  // No more bodies fit. Said at the door rather than at the refusal, because a mind that has
  // to be turned away to learn it has already spent the turn.
  full?: true
  // How far up the walls are, while a thing is still going up. Every hand on a site adds one to
  // the walls, so this is the one number that says whether tonight is long enough.
  raised?: { done: number; needs: number }
  // The fire in the room, and whether anybody is feeding it. Absent on a building whose kind
  // holds no fire and on one still going up, so a packet from a town of sheds reads as before.
  hearth?: 'lit' | 'cold'
  // There is a bed in it. Absent on a roof with nothing but a floor under it.
  bed?: true
}

type PerceptionCrop = {
  id: string
  kind: string
  x: number
  y: number
  stage: number
  withered: boolean
}

// A shape at a distance and a patch of ground worth working: `hunt` wants an id and `forage`
// a node, and neither was nameable before.
type PerceptionFauna = { id: string; kind: string; x: number; y: number }
type PerceptionForageable = { id: string; kind: string; x: number; y: number; prose: string }

export type PerceptionPacket = {
  time: SimTime
  self: {
    body: {
      needs: { hunger: number; energy: number; warmth: number; social: number }
      hp: number
      injuries: { kind: 'minor' | 'serious' | 'grave'; day: number }[]
      ill: boolean
      thirst?: number
      // What ails this body and how badly. Absent on a packet from before C11 named them.
      afflictions?: { kind: string; severity: number }[]
    }
    x: number
    y: number
    asleep: boolean
    collapsed: boolean
    activity: string | null
    // Where the legs are already going. Absent when they are not.
    activityToward?: { x: number; y: number }
    // The roof overhead. Absent under open sky, so an outdoor packet reads as it always did.
    inside?: { id: string; kind: string }
    inventory: PerceptionItem[]
  }
  weather: { kind: string; temperatureC: number }
  // Absent on plain earth; present when road or worn path runs under or beside the feet.
  ground?: { wellTravelled: true }
  // Present only while the dark is charging this body for the work in its hands.
  fumbling?: true
  // How the cold stands against this body: getting in, or held off, and by what. Absent
  // whenever the air is warm enough that nothing is deciding anything.
  cold?: { biting: true } | { keptOffBy: 'walls' | 'coat' | 'fire' }
  // Present only while the legs are on a route that stops short of where they were sent.
  wayUnclear?: true
  // How much light is on the ground underfoot. Absent on a packet from before the dark had
  // a price, which reads as it always did.
  light?: 'bright' | 'dim' | 'dark'
  visible: {
    agents: PerceptionAgent[]
    structures: PerceptionStructure[]
    items: PerceptionItem[]
    crops: PerceptionCrop[]
    // Absent on a packet from before the mind side could see them, which reads as before.
    fauna?: PerceptionFauna[]
    forageables?: PerceptionForageable[]
  }
  // What the hands can touch and which named spots no foot can take, both read off the verbs'
  // own tests. Absent on a packet from before it was composed, which reads as it always did.
  reach?: { atHand: string[]; noFooting: { x: number; y: number }[] }
  heard: { speakerId: string; name: string; text: string; distance: number }[]
  seen: PerceptionSeen[]
  feltEvents: string[]
}

// Structured felt tags → fiction. Unknown tags fall through to a generic
// sentence plus an alert, so a new C2 tag degrades to prose, never a crash.
export const FELT_EVENT_PROSE: Record<string, string> = {
  rain_started: 'Rain begins to fall.',
  storm_started: 'A storm breaks overhead; wind and rain lash down.',
  snow_started: 'Snow begins to fall.',
  you_were_attacked: 'Pain. Someone has struck you!',
  you_collapsed:
    'Your legs give under you and the ground comes up; you cannot get back on your feet.',
  you_died: 'Everything goes far away and very quiet, and then there is nothing left to feel.',
  you_fell_ill: 'A sickness settles into you; your skin burns, your limbs turn heavy.',
  you_were_infected:
    'A wound of yours has turned bad; it throbs hot and the skin around it is angry.',
  you_recovered: 'The sickness lifts. Your head clears and your strength begins to come back.',
  you_were_tended: 'Someone has cared for your hurts; the pain eases under their hands.',
  fire_ignited: 'Smoke stings your nose. Something nearby is burning.',
  fire_spread: 'The fire is spreading; the smell of smoke grows thicker.',
  fire_extinguished: 'The smoke thins and the air clears.',
  // The engine's table is the single copy of this prose; a mystery must read as
  // itself and never as the generic "something changed nearby" fallback.
  ...Object.fromEntries(
    MYSTERIES.filter((m) => m.scope === 'global').map((m) => [m.kind, m.prose]),
  ),
}

const UNKNOWN_FELT_PROSE = 'You sense something change nearby.'

// What ails a body, said as it feels and never as a number (G10). The alarm now wakes a mind
// for any of these, and a mind woken by poison has to be able to feel the poison.
const AFFLICTION_PROSE: Record<string, string> = {
  injury: 'A hurt on your body throbs and will not let you forget it.',
  poison: 'Your gut cramps and turns; something you ate has gone against you.',
  illness: 'A sickness is in you: heat behind the eyes, weight in the limbs.',
  fatigue: 'A tiredness sits in your bones that sleep has not lifted.',
}

const AFFLICTION_SEVERE = 3

// The three things that can stand between a body and a cold night, each said as the body has
// it. They mirror `isExposed`'s own order, so the sentence and the law can never disagree.
const COLD_KEPT_OFF: Record<'walls' | 'coat' | 'fire', string> = {
  walls: 'The air out there is cold; in here these walls are holding it off you.',
  coat: 'The air is cold, and what you have on your back is holding it off you.',
  fire: 'The air is cold, and the fire at your side is holding it off you.',
}

const WEATHER_KIND_PROSE: Record<string, string> = {
  sunny: 'The sun is out.',
  cloudy: 'Clouds hang low.',
  rain: 'Rain falls steadily.',
  storm: 'A storm churns overhead.',
  snow: 'Snow drifts from the sky.',
}

const NIGHT_WEATHER_KIND_PROSE: Record<string, string> = {
  sunny: 'The night sky is clear.',
  cloudy: 'The night is overcast.',
  rain: 'Rain falls in the dark.',
  storm: 'A storm rages through the night.',
  snow: 'Snow drifts down through the dark.',
}

function temperatureLine(temperatureC: number): string {
  if (temperatureC < 0) return 'The air bites with cold.'
  if (temperatureC < 10) return 'The air is cool.'
  if (temperatureC < 22) return 'The air is mild.'
  return 'The air is warm.'
}

// `isNight` is the single source of truth for day vs night; a 'sunny' sky at
// night is a clear night, never a sunlit day.
function weatherLine(weather: { kind: string; temperatureC: number }, isNight: boolean): string {
  const table = isNight ? NIGHT_WEATHER_KIND_PROSE : WEATHER_KIND_PROSE
  const kind =
    table[weather.kind] ??
    (isNight ? `The night sky is ${weather.kind}.` : `The sky is ${weather.kind}.`)
  return `${kind} ${temperatureLine(weather.temperatureC)}`
}

// Which third of its season a day falls in. Three words for ninety-one days, which is as
// fine as anybody outdoors actually tells it.
function seasonPart(dayOfSeason: number): string {
  if (dayOfSeason <= DAYS_PER_SEASON / 3) return 'early'
  return dayOfSeason <= (DAYS_PER_SEASON * 2) / 3 ? 'mid' : 'late'
}

// What the world CALLS this day, which is one more than the zero-based `day` column every
// table stores. Anything dated for a mind counts days the way the calendar line says them.
export function worldDay(tick: number): number {
  return Math.floor(tick / MINUTES_PER_DAY) + 1
}

// The calendar every mind shares, said the same way every turn. The phase is
// `dayPhaseFromTick` and never a second derivation.
export function calendarLine(time: SimTime): string {
  return `It is day ${worldDay(time.tick)}, ${dayPhaseFromTick(time.tick)}, ${seasonPart(time.dayOfSeason)} ${time.season}.`
}
function footprintPhrase(w: number, h: number): string {
  if (w <= 1 && h <= 1) return 'one tile wide'
  return `${w} ${w === 1 ? 'tile' : 'tiles'} wide and ${h} ${h === 1 ? 'tile' : 'tiles'} tall`
}

// Answers about the world the packet cannot carry: whether ground is open to
// stand on, and whether a carried kind is food. Both come from the bridge.
/** What a material can be found as: a node still standing, a tree, or a stack somebody left. */
export type SourceKind = ForageableKind | 'tree' | 'stack'

export type ProseWorld = {
  isWalkable?: (x: number, y: number) => boolean
  isEdible?: (kind: string) => boolean
  // Where the water is. Nothing in the packet can say: terrain is the one thing perception
  // never projects, and block 1 now teaches two verbs that need it.
  waterAtHand?: () => boolean
  nearestWater?: (x: number, y: number) => { x: number; y: number } | null
  // Where the food is. The same answer thirst has had since the last batch, for the need that
  // never got one: the run that drank fifteen times ate once (R21).
  nearestFood?: (x: number, y: number) => { x: number; y: number; kind: string } | null
  // Who is out there. The same answer food and water have, for the last want that had none:
  // the low band said only that it was lonely.
  nearestPerson?: (x: number, y: number) => { x: number; y: number; name: string } | null
  // Where a material comes from. The same answer food and water have; wanting to build was the
  // only drive left with a cost and no place to go.
  nearestSource?: (
    kind: string,
    x: number,
    y: number,
  ) => { x: number; y: number; from: SourceKind } | null
  // Whether the night now coming is one the cold gets into. Read off the season's own band, so
  // a summer evening is never told to go for wood.
  nightWillBeCold?: () => boolean
}

// Nearest open tile ringing a structure's footprint (Manhattan to self);
// row-major scan keeps ties deterministic (lower y, then lower x).
function besideTile(
  s: { x: number; y: number; w: number; h: number },
  self: { x: number; y: number },
  isWalkable: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestDist = Infinity
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      const inside = x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h
      if (inside || !isWalkable(x, y)) continue
      const d = Math.abs(x - self.x) + Math.abs(y - self.y)
      if (d < bestDist) {
        bestDist = d
        best = { x, y }
      }
    }
  }
  return best
}

// Whose it is and whose hands made it, in the order prose wants them. Empty for
// an unclaimed thing, so a town that owns nothing reads exactly as it always did.
function claimPhrase(i: PerceptionItem): string {
  const parts: string[] = []
  if (i.ownerName !== undefined) parts.push(`${i.ownerName}'s`)
  if (i.crafterMarkName !== undefined) parts.push(`marked by ${i.crafterMarkName}`)
  if (i.spoiling === true) parts.push('it is turning')
  return parts.length === 0 ? '' : `; ${parts.join(', ')}`
}

// What a thing costs, in the words a refusal already uses for it. `inputName` turns the two
// canon classes into plain words; the singular is only ever needed by "vegetables".
/** A recipe key as a person says it. Five sites in this file spelled it out by hand. */
const words = (kind: string): string => kind.replace(/_/g, ' ')

function costPhrase(inputs: Record<string, number>): string {
  return Object.keys(inputs)
    .sort()
    .map((k) => {
      const qty = inputs[k]!
      const word = inputName(k)
      return `${qty} ${qty === 1 ? word.replace(/s$/, '') : word}`
    })
    .join(' and ')
}

function roadPhrase(r: MakeableRoad): string {
  const conditions: string[] = []
  if (r.atFire === true) conditions.push('at a fire someone is feeding')
  if (r.water !== undefined) conditions.push('with water in something you carry')
  return [costPhrase(r.inputs), ...conditions].join(', ')
}

// How far up in words, not a tick count: "still being built" reads the same one hour short as
// four days short.
const HOW_FAR = [
  'barely begun',
  'a little way up',
  'a quarter of the way up',
  'a third of the way up',
  'half up',
  'well past half',
  'three quarters up',
  'nearly done',
]

export function howFarUp(raised?: { done: number; needs: number }): string {
  if (raised === undefined || raised.needs <= 0) return 'still being built'
  const f = Math.max(0, Math.min(1, raised.done / raised.needs))
  const i = Math.min(HOW_FAR.length - 1, Math.floor(f * HOW_FAR.length))
  return `its walls are ${HOW_FAR[i]}`
}

// Block 6, not block 1: the static prefix is byte-frozen and prompt caching rides on it.
/** The other place work can go: where walls already stand, and how far up. */
export function standingWallsLine(
  w?: { kind: string; at: { x: number; y: number }; done: number; needs: number } | null,
): string {
  if (w === undefined || w === null) return ''
  return `Walls already stand at (${w.at.x}, ${w.at.y}): a ${words(w.kind)}, ${howFarUp({
    done: w.done,
    needs: w.needs,
  }).replace(/^its walls are /, '')}.`
}

export function makeablesLine(
  m: Makeables,
  groundForBuilding?: { x: number; y: number } | null,
): string {
  const parts: string[] = []
  if (m.builds.length > 0) {
    parts.push(
      `What your hands know how to raise, given the stuff and a spot to put it: ${m.builds
        .map((b) => `a ${words(b.kind)} (${costPhrase(b.inputs)})`)
        .join(', ')}.`,
    )
    // "to begin a new one", never "to raise one": this ground is where a roof starts, and walls
    // that already stand are raised where they stand.
    if (groundForBuilding !== undefined && groundForBuilding !== null) {
      parts.push(
        `The town keeps ground for a new roof at (${groundForBuilding.x}, ${groundForBuilding.y}); you must be standing there to begin a new one.`,
      )
    }
  }
  if (m.crafts.length > 0) {
    parts.push(
      `What they know how to shape: ${m.crafts
        .map((c) => `${words(c.name)} (${c.roads.map(roadPhrase).join(', or ')})`)
        .join(', ')}.`,
    )
  }
  return parts.join(' ')
}

// What a source looks like when you get there, keyed off the engine's own roster so a node kind
// added there cannot quietly be described here as a stack somebody left on the ground.
const SOURCE_PHRASE: Readonly<Record<Exclude<SourceKind, 'stack'>, string>> = {
  tree: 'standing tree',
  stone_outcrop: 'stone outcrop',
  clay_deposit: 'clay bank',
  reed_bed: 'reed bed',
  berry_bush: 'berry bush',
  herb_patch: 'herb patch',
  mushroom_patch: 'mushroom ground',
  pale_mushroom_patch: 'pale mushroom ground',
}

// One thing a route still wants. A material can be fetched, so it names a place; a condition is
// a thing to be standing in, and names the nearest place that satisfies it.
type Want = { say: string; gap: number; kinds: string[]; cond?: 'fire' | 'water' }

/** The nearest structure in sight whose hearth is in the named state. */
function nearestHearth(
  packet: PerceptionPacket,
  state: 'lit' | 'cold',
): PerceptionStructure | null {
  const { x, y } = packet.self
  let near: PerceptionStructure | null = null
  let bestD = Infinity
  for (const s of packet.visible.structures) {
    if (s.hearth !== state) continue
    const d = Math.abs(s.x - x) + Math.abs(s.y - y)
    if (d >= bestD) continue
    bestD = d
    near = s
  }
  return near
}

/** How many of a kind the hands hold, counting every member of a class input. */
function heldFor(held: Map<string, number>, kind: string): number {
  const members = classMembers(kind)
  if (members === undefined) return held.get(kind) ?? 0
  return members.reduce((total, m) => total + (held.get(m) ?? 0), 0)
}

/** What a single road to a thing still wants, in the order a sentence would say them. */
function wantsOf(
  inputs: Record<string, number>,
  road: MakeableRoad | null,
  held: Map<string, number>,
  atAFire: boolean,
): Want[] {
  const wants: Want[] = []
  for (const kind of Object.keys(inputs).sort()) {
    const needs = inputs[kind]!
    const gap = needs - heldFor(held, kind)
    if (gap <= 0) continue
    wants.push({
      say: costPhrase({ [kind]: needs }),
      gap,
      kinds: [...(classMembers(kind) ?? [kind])],
    })
  }
  // A condition is one thing missing however far away it is: you are at a fire or you are not.
  if (road?.atFire === true && !atAFire)
    wants.push({ say: 'a fire someone is feeding', gap: 1, kinds: [], cond: 'fire' })
  // Perception never composes a vessel's charges, so a full skin and an empty one read alike.
  // Counted as wanted either way: over-counting costs a redundant sentence, under-counting
  // ranks a pot a mind cannot fill above a roof it could raise today.
  if (road?.water !== undefined)
    wants.push({ say: 'water in something you carry', gap: 1, kinds: [], cond: 'water' })
  return wants
}

const totalOf = (inputs: Record<string, number>): number =>
  Object.values(inputs).reduce((t, n) => t + n, 0)

const gapOf = (wants: Want[]): number => wants.reduce((t, w) => t + w.gap, 0)

/** A stack is the stuff itself and names no source; everything else stands somewhere. */
function sourcePhrase(from: SourceKind, kind: string): string {
  return from === 'stack' ? `${inputName(kind)} lying where it was left` : SOURCE_PHRASE[from]
}

/** Where the thing this want names can be found, or '' when nothing in sight answers it. */
function placeOf(want: Want, packet: PerceptionPacket, world: ProseWorld): string {
  if (want.cond === 'fire') {
    const fire = nearestHearth(packet, 'lit')
    return fire === null
      ? ''
      : `; the hearth in the ${words(fire.kind)} at (${fire.x}, ${fire.y}) is lit`
  }
  if (want.cond === 'water') {
    const w = world.nearestWater?.(packet.self.x, packet.self.y) ?? null
    return w === null ? '' : `; the nearest water lies at (${w.x}, ${w.y})`
  }
  for (const kind of want.kinds) {
    const at = world.nearestSource?.(kind, packet.self.x, packet.self.y) ?? null
    if (at === null) continue
    return `; the nearest ${sourcePhrase(at.from, kind)} is at (${at.x}, ${at.y})`
  }
  return ''
}

/** The road the makeables list never had: the one cost this mind is nearest to covering, and
 *  where that stuff stands. Builds and crafts rank together, so the road climbs as hands fill. */
function makeableRoadLine(m: Makeables, packet: PerceptionPacket, world?: ProseWorld): string {
  if (world?.nearestSource === undefined) return ''
  const held = new Map<string, number>()
  for (const i of packet.self.inventory) held.set(i.kind, (held.get(i.kind) ?? 0) + i.qty)
  const atAFire = nearestHearth(packet, 'lit') !== null

  type Candidate = { subject: string; want: Want; gap: number }
  const candidates: Candidate[] = []
  const offer = (subject: string, wants: Want[]): void => {
    // Nothing missing means the hands can make it now; block 6 already says so.
    if (wants.length === 0) return
    candidates.push({ subject, want: wants[0]!, gap: gapOf(wants) })
  }

  for (const build of m.builds) {
    offer(`A ${words(build.kind)}`, wantsOf(build.inputs, null, held, atAFire))
  }
  for (const craft of m.crafts) {
    // Fewest things still missing; then least of them to fetch, so a mind one hide from a
    // garment is not sent for two cloth; then the cheapest recipe of what is left.
    const routes = craft.roads
      .map((road) => ({ road, wants: wantsOf(road.inputs, road, held, atAFire) }))
      .sort(
        (a, b) =>
          a.wants.length - b.wants.length ||
          gapOf(a.wants) - gapOf(b.wants) ||
          totalOf(a.road.inputs) - totalOf(b.road.inputs),
      )
    const name = words(craft.name)
    offer(`${name.charAt(0).toUpperCase()}${name.slice(1)}`, routes[0]?.wants ?? [])
  }
  // First minimum wins, so builds outrank crafts on a tie and the order stays deterministic.
  const best = candidates.reduce<Candidate | null>(
    (b, c) => (b === null || c.gap < b.gap ? c : b),
    null,
  )
  if (best === null) return ''
  return `${best.subject} wants ${best.want.say}${placeOf(best.want, packet, world)}.`
}

/** The hearth the cold road would name tonight, or null when it has nothing to say. The roads
 *  that wait below the cold read this and not the sentence, so neither pays for the other. */
function coldRoadHearth(packet: PerceptionPacket, world?: ProseWorld): PerceptionStructure | null {
  if (packet.time.hour < EVENING_HOUR || packet.time.isNight) return null
  if (world?.nightWillBeCold?.() !== true) return null
  return nearestHearth(packet, 'cold')
}

/** The road to a fed fire, opened while there is still light to walk it by. The cold is real —
 *  warmth zero burns energy at twice the rate, which is the collapse ladder. */
function coldHearthLine(packet: PerceptionPacket, world?: ProseWorld): string {
  const near = coldRoadHearth(packet, world)
  if (near === null) return ''
  const line = `The night will be cold; the hearth in the ${words(near.kind)} at (${near.x}, ${near.y}) is cold and wants wood.`
  // Hands that already hold the wood need no road to a tree, only the fire it is wanted at.
  if (packet.self.inventory.some((i) => i.kind === FUEL_ITEM)) return line
  const at = world?.nearestSource?.(FUEL_ITEM, packet.self.x, packet.self.y) ?? null
  if (at === null) return line
  return `${line} The nearest ${sourcePhrase(at.from, FUEL_ITEM)} is at (${at.x}, ${at.y}).`
}

/** A place a mind carries in its head: what it is called, if anything, and where it stands. */
export type KnownPlace = { id: string; kind: string; x: number; y: number; name?: string }

// One spelling of a place for the whole prompt: a named one is called by its name, an unnamed
// one is only ever pointed at. `words` keeps a lamp_post from reaching a mind with the underscore.
const placeSaid = (p: { kind: string; name?: string }): string => p.name ?? `a ${words(p.kind)}`
const opening = (said: string): string => `${said.charAt(0).toUpperCase()}${said.slice(1)}`

// Map frame, which is the frame a body walks in: the smaller y is the further north.
const COMPASS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const

function bearing(dx: number, dy: number): string {
  const octant = Math.round(Math.atan2(dx, -dy) / (Math.PI / 4))
  return COMPASS[((octant % 8) + 8) % 8]!
}

// How far, as a body would say it and never as a number: a mind walking by name has no use
// for the tile, and a count of tiles is the guessing this was built to end.
const howFar = (d: number): string =>
  d <= 10 ? 'close to the' : d <= 25 ? 'a way to the' : 'far to the'

// A whole town read back every turn is a page of standing facts. The nearest dozen is what a
// person holds in their head anyway.
const PLACES_SHOWN = 12

/** Where this mind could go without seeing it first: everything it knows of that is not already
 *  in front of it, nearest first. The block a mind names a place out of. */
export function placesKnownLine(places: KnownPlace[], packet: PerceptionPacket): string {
  const inSight = new Set(packet.visible.structures.map((s) => s.id))
  const { x, y } = packet.self
  const lines = places
    .filter((p) => !inSight.has(p.id))
    .map((p) => ({ p, d: Math.hypot(p.x - x, p.y - y) }))
    .sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : 1))
    .slice(0, PLACES_SHOWN)
    .map(({ p, d }) => `${placeSaid(p)} (${p.id}), ${howFar(d)} ${bearing(p.x - x, p.y - y)}`)
  return lines.length === 0 ? '' : `Places you know:\n${lines.join('\n')}`
}

/** One road a turn, and the cold picks first: a mind that freezes tonight builds nothing. */
export function roadLine(m: Makeables, packet: PerceptionPacket, world?: ProseWorld): string {
  return coldHearthLine(packet, world) || makeableRoadLine(m, packet, world)
}

/** Inside, both states; from outside only a lit one — firelight through a doorway is what eyes
 *  get, and a cold hearth in every house in sight is five lines a turn of no news. */
function hearthClause(s: PerceptionStructure, isTheRoomYouAreIn: boolean): string {
  if (s.hearth === undefined) return ''
  if (isTheRoomYouAreIn) {
    return s.hearth === 'lit'
      ? ' A fire is burning in the hearth here.'
      : ' The hearth here is cold.'
  }
  return s.hearth === 'lit' ? ' Firelight moves inside it.' : ''
}

/** Said before the walk, not at the door: two roofs the same size are not the same night. */
function bedClause(s: PerceptionStructure, isTheRoomYouAreIn: boolean): string {
  if (s.bed !== true) return ''
  return isTheRoomYouAreIn ? ' There are beds in here.' : ' There are beds in it.'
}

// Renders mechanics as fiction. Every clause here states a fact and names no act — no remedy,
// no counsel, no comparison; the inference is the mind's.
/** Every utterance in earshot, one per line. Kept out of the perception prose: a delimiter a
 *  speaker cannot write stops a forged attribution, and only separation stops a forged voice. */
export function heardProse(packet: PerceptionPacket): string {
  return packet.heard.map((h) => heardLine(h.name, h.text)).join('\n')
}

// Long enough to name the walls a mind keeps aiming at, short enough that a crowded square
// does not spend the block on ground.
const NO_FOOTING_MAX = 4

// Five hours of light left, not the two that dusk is: fetching wood and walking back with it is
// the road, and thirst proved what a road opened ten ticks before the need is worth.
const EVENING_HOUR = 16

// What a fire eats, and the one material the ground itself grows.
const FUEL_ITEM = 'wood'

function itemPhrase(i: { qty: number; kind: string; id: string }): string {
  return `${i.qty} ${i.kind} (${i.id})`
}

/** Two sentences said before the turn is spent, each clause the packet's copy of a validator's
 *  own test. Forty-four of run B's refusals were these facts going unsaid (rehearsal4). */
function affordanceLines(packet: PerceptionPacket): string[] {
  const { x, y } = packet.self
  const inside = packet.self.inside
  const lines: string[] = []

  if (inside === undefined) {
    const barred = (packet.reach?.noFooting ?? []).slice(0, NO_FOOTING_MAX)
    const walls =
      barred.length === 0
        ? ''
        : ` Wall or water covers ${barred.map((p) => `(${p.x}, ${p.y})`).join(', ')}; no walk of yours can end there.`
    lines.push(
      `No walls are around you: there is nothing to step out of, and no walk can end where you already stand, at (${x}, ${y}).${walls}`,
    )
  } else {
    const door = packet.visible.structures.find((s) => s.id === inside.id)?.door
    const out =
      door === undefined
        ? 'you can see no way back out under the sky'
        : `the doorway at (${door.x}, ${door.y}) is the way back out under the sky`
    lines.push(
      `Four walls are around you: while you are inside the ${inside.kind} (${inside.id}) you can walk nowhere and enter nothing, and ${out}.`,
    )
  }

  const atHand = new Set(packet.reach?.atHand ?? [])
  const near = packet.visible.items.filter((i) => atHand.has(i.id))
  const held = packet.self.inventory
  let hands =
    held.length === 0
      ? 'Your hands are empty'
      : `Your hands hold ${held.map(itemPhrase).join(', ')}`
  // No `reach` at all is a packet composed before the block existed: it says nothing about
  // reach rather than claiming there is none.
  if (packet.reach !== undefined) {
    hands +=
      near.length === 0
        ? `; nothing${held.length === 0 ? '' : ' else'} is close enough for them to touch`
        : `; close enough for them to touch, but not yet in them: ${near.map(itemPhrase).join(', ')}`
  }
  lines.push(`${hands}.`)
  return lines
}

export function perceptionToProse(
  packet: PerceptionPacket,
  alert?: (detail: string) => void,
  world?: ProseWorld,
): string {
  const lines: string[] = []
  const { x, y } = packet.self

  lines.push(calendarLine(packet.time))
  const inside = packet.self.inside
  const where = inside === undefined ? '' : ` inside the ${inside.kind} (${inside.id})`
  lines.push(
    `You ${packet.self.asleep ? 'sleep' : packet.self.collapsed ? 'lie' : 'stand'}${where} at (${x}, ${y}).`,
  )
  lines.push(...affordanceLines(packet))

  if (packet.self.collapsed) lines.push('You have collapsed from exhaustion and cannot move.')

  // What the body is already doing. A mind told it is standing still sets out again, and
  // again: one founder said she was leaving for the berries in forty-four turns (R21).
  if (packet.self.activity !== null && !packet.self.asleep) {
    const toward = packet.self.activityToward
    lines.push(
      toward === undefined
        ? `Your hands are already busy; you are partway through ${packet.self.activity}, and it will finish before anything else can begin.`
        : `Your legs are already carrying you toward (${toward.x}, ${toward.y}); you will get there if you let them.`,
    )
  }

  const { hunger, energy, warmth, social } = packet.self.body.needs
  if (hunger < 5) lines.push('Your stomach aches with hunger.')
  else if (hunger < 30) lines.push('Your stomach gnaws at you.')
  // The same ladder hunger uses. A packet from before thirst existed reads as a full body.
  const thirst = packet.self.body.thirst ?? 100
  if (thirst < 5) lines.push('Your throat burns with thirst.')
  else if (thirst < 30) lines.push('Your mouth is dry.')
  if (energy < 10) lines.push('You are about to collapse; sleep is taking you where you stand.')
  else if (energy < 25)
    lines.push('Your legs tremble. You can barely stand, and your eyes keep closing.')
  else if (energy < 30) lines.push('Weariness drags at your limbs.')
  if (warmth < 30) lines.push('You shiver against the cold.')
  // Where the cold is, and what stands between: the pair is the whole of what there is to learn.
  if (packet.cold !== undefined) {
    lines.push(
      'biting' in packet.cold
        ? 'The cold is getting into you out here.'
        : COLD_KEPT_OFF[packet.cold.keptOffBy],
    )
  }
  if (social < 30) lines.push('Loneliness settles over you.')
  if (packet.self.body.hp < 30) lines.push('Your body aches with its hurts.')
  if (packet.self.body.ill) lines.push('A fever grips you; you feel weak.')
  for (const a of packet.self.body.afflictions ?? []) {
    const prose = AFFLICTION_PROSE[a.kind]
    if (prose !== undefined)
      lines.push(a.severity >= AFFLICTION_SEVERE ? `${prose} It is very bad.` : prose)
  }

  const roads: string[] = []

  // Never a refusal, and opened well before the dryness is felt: thirst decays 1.67x slower
  // than hunger, so the 30 both once shared left the water road 10 ticks of runway.
  if (thirst < 50) {
    if (world?.waterAtHand?.() === true) {
      roads.push(
        'Water lies within reach of your hands. You could drink here, or fill what you carry.',
      )
    } else {
      const w = world?.nearestWater?.(x, y) ?? null
      if (w !== null) roads.push(`The nearest water you know of lies at (${w.x}, ${w.y}).`)
    }
  }

  // The road thirst has had, given to the need that never had one. Hands first, then the
  // nearest thing worth walking to — and never as a refusal.
  if (hunger < 30) {
    const food =
      world?.isEdible === undefined
        ? undefined
        : packet.self.inventory.find((i) => world.isEdible!(i.kind))
    if (food) roads.push(`Your satchel holds ${food.kind} (${food.id}). You could eat it now.`)
    else {
      const f = world?.nearestFood?.(x, y) ?? null
      if (f !== null) roads.push(`The nearest food you know of is ${f.kind} at (${f.x}, ${f.y}).`)
    }
  }

  // The last want with no road. It waits below the survival ones, and speaks only in the turns
  // where the cold, the water and the food have nothing to say.
  if (social < 30 && roads.length === 0 && coldRoadHearth(packet, world) === null) {
    const p = world?.nearestPerson?.(x, y) ?? null
    if (p !== null) roads.push(`The nearest person you know of is ${p.name}, at (${p.x}, ${p.y}).`)
  }
  lines.push(...roads)

  lines.push(weatherLine(packet.weather, packet.time.isNight))

  // What the dark is doing where the body stands. Silent in plain daylight.
  if (packet.light === 'dark') lines.push('The night is close around you.')
  else if (packet.light === 'dim')
    lines.push(
      dayPhaseFromTick(packet.time.tick) === 'dawn'
        ? 'The first light is coming into the day.'
        : 'The last of the light is going out of the day.',
    )
  else if (packet.light === 'bright' && packet.time.isNight)
    lines.push('A fire throws a circle of light around you.')

  // The physics, said plainly. What it is worth building here is not the ground's to say.
  if (packet.ground?.wellTravelled) lines.push('Carts and feet reach this spot easily.')

  // The cost, said as it feels. Never a refusal, and never a number.
  if (packet.fumbling) lines.push('You fumble in the dark.')

  // Where the legs are going, and how far of it the body actually knows. Not a refusal.
  if (packet.wayUnclear) lines.push('The way is unclear from here.')

  for (const a of packet.visible.agents) {
    const dressed = a.worn === undefined ? '' : `, ${a.worn}`
    // Said last, because it is the thing a pair of eyes lands on: a body nobody can see is
    // ailing is a body nobody tends, and the live run tended nobody at all.
    const ails = a.condition === undefined ? '' : `, ${a.condition}`
    const where = `(${a.x}, ${a.y})${dressed}${ails}`
    if (a.asleep) lines.push(`${a.name} (${a.id}) sleeps at ${where}.`)
    else if (a.collapsed) lines.push(`${a.name} (${a.id}) lies collapsed at ${where}.`)
    else lines.push(`${a.name} (${a.id}) stands at ${where}.`)
  }

  for (const s of packet.visible.structures) {
    const state = s.burning
      ? ', and it is burning'
      : s.stage === 'construction'
        ? `, and ${howFarUp(s.raised)}`
        : ''
    // The doorway outranks the wall: the tile the packet names is the tile `enter` measures
    // against, so a mind told to stand there is a mind the world lets in.
    let approach = 'walk to a tile beside it.'
    if (s.id === inside?.id) {
      approach =
        s.door === undefined
          ? 'this is the roof you are under.'
          : `this is the roof you are under; the way out is at (${s.door.x}, ${s.door.y}).`
    } else if (s.door !== undefined) {
      // ★ FULL IS A FACT, NOT A REFUSAL. It names the doorway either way, so a mind can tell a
      // room that is full now from a wall with no way through it ever — and can come back.
      approach =
        s.full === true
          ? `its doorway is at (${s.door.x}, ${s.door.y}), and there is no floor left in it.`
          : `its doorway is at (${s.door.x}, ${s.door.y}); stand there and you can go in.`
    } else if (world?.isWalkable) {
      const t = besideTile(s, packet.self, world.isWalkable)
      approach =
        t === null
          ? 'no open ground lies beside it.'
          : `you could stand beside it at (${t.x}, ${t.y}).`
    }
    // Said at the wall instead of at the refusal: how far up the walls are never said that
    // there is nothing behind them yet.
    const hollow = s.stage === 'construction' ? ' There is no inside to it yet.' : ''
    lines.push(
      `${opening(placeSaid(s))} (${s.id}) stands at (${s.x}, ${s.y}), ${footprintPhrase(s.w, s.h)}${state}; ${
        approach
      }${hollow}${hearthClause(s, s.id === inside?.id)}${bedClause(s, s.id === inside?.id)}`,
    )
  }

  for (const i of packet.visible.items) {
    const pos = i.loc.t === 'tile' ? ` at (${i.loc.x}, ${i.loc.y})` : ''
    lines.push(`You can see ${itemPhrase(i)}${pos}${claimPhrase(i)}.`)
  }

  for (const c of packet.visible.crops) {
    lines.push(
      `You can see ${c.kind} (${c.id}) at (${c.x}, ${c.y})${c.withered ? ', withered' : ''}.`,
    )
  }

  // Named, so a mind can point at one: `hunt` wants a faunaId and `forage` a nodeId, and
  // neither was ever nameable before.
  for (const f of packet.visible.fauna ?? []) {
    lines.push(`A ${f.kind} (${f.id}) is out at (${f.x}, ${f.y}).`)
  }

  for (const n of packet.visible.forageables ?? []) {
    lines.push(`You see ${n.prose} (${n.id}) at (${n.x}, ${n.y}).`)
  }

  for (const it of packet.self.inventory) {
    lines.push(`You are carrying ${itemPhrase(it)}${claimPhrase(it)}.`)
  }

  for (const s of packet.seen) {
    if (s.kind === 'item_taken')
      lines.push(`You watch ${s.takerName} take ${s.ownerName}'s ${s.itemKind}.`)
    else if (s.kind === 'expression') {
      lines.push(
        s.sense === 'sound'
          ? `You hear ${s.actorName} ${s.verb}.`
          : `You watch ${s.actorName} ${s.verb}.`,
      )
    } else lines.push(s.prose)
  }

  for (const tag of packet.feltEvents) {
    const prose = FELT_EVENT_PROSE[tag]
    if (prose) lines.push(prose)
    else {
      lines.push(UNKNOWN_FELT_PROSE)
      alert?.(`unknown felt tag: ${tag}`)
    }
  }

  return lines.join(' ')
}
