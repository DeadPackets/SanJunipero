import {
  type BondLevel,
  bondLevel,
  dayPhaseFromTick,
  DAYS_PER_SEASON,
  weekdayFromTick,
  inputName,
  MINUTES_PER_DAY,
  heardLine,
  type SimTime,
} from '@sj/shared'
import { MYSTERIES, type ForageableKind, type MakeableRoad, type Makeables } from '@sj/engine'
import { classMembers } from '@sj/shared'
import type { WantKind } from '../memory/wants.js'

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
  marks?: Record<string, string>
  loc:
    | { t: 'tile'; x: number; y: number }
    | { t: 'agent'; id: string }
    | { t: 'structure'; id: string }
}

// Things this agent watched happen: a taking that was not theirs, or one of the
// world's unexplained happenings close enough to see.
type PerceptionSeen =
  | { kind: 'item_taken'; takerName: string; ownerName: string; itemKind: string }
  | { kind: 'law_broken'; breakerName: string; lawText: string; self: boolean }
  | { kind: 'mystery'; mystery: string; prose: string }
  | {
      kind: 'expression'
      actorName: string
      verb: string
      sense: 'sight' | 'sound'
      // What a minted act looks or sounds like, in the words its charter gave it.
      label?: string
    }
  | {
      kind: 'discovery'
      inventorName: string
      pronoun: 'he' | 'she'
      name: string
      saying?: string
    }
  // Somebody walked in off the valley road where this pair of eyes could see the edge.
  | { kind: 'stranger_arrived'; name: string }

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
  // A face the valley has only just seen for the first time. Absent once the town is used to it.
  stranger?: true
  // Tags a minted verb left on the body, readable by anyone who can see it.
  marks?: Record<string, string>
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
  marks?: Record<string, string>
}

// A shelf this mind may use and what stands on it. `yours` is absent on the town's own store.
type PerceptionStore = {
  structureId: string
  kind: string
  name?: string
  // Whose walls they are, when they are not this mind's own. Absent on the town's store.
  ownerName?: string
  yours?: true
  items: { kind: string; qty: number }[]
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
      // Since the last meal. Absent on a packet from before appetite kept time.
      hoursSinceMeal?: number
    }
    x: number
    y: number
    asleep: boolean
    collapsed: boolean
    activity: string | null
    // Where the legs are already going. Absent when they are not.
    activityToward?: { x: number; y: number }
    // The roof overhead. Absent under open sky, so an outdoor packet reads as it always did.
    // Whose it is rides with it; both absent on walls nobody owns.
    inside?: { id: string; kind: string; yours?: true; ownerName?: string }
    inventory: PerceptionItem[]
    // Your own things heaped on the ground by your own wall. Absent on a tidy doorstep.
    doorstep?: { kind: string; qty: number }[]
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
  // Present only while the feet are on the last row or column the map has.
  atRim?: true
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
  // The shelves this mind may use, wherever its feet are. Absent on a packet from before the
  // town had anywhere to put things, which reads as it always did.
  stores?: PerceptionStore[]
  heard: { speakerId: string; name: string; text: string; distance: number }[]
  seen: PerceptionSeen[]
  feltEvents: string[]
}

// Structured felt tags → fiction. Unknown tags fall through to a generic
// sentence plus an alert, so a new C2 tag degrades to prose, never a crash.
export const FELT_EVENT_PROSE: Record<string, string> = {
  rain_started: 'It has started raining.',
  storm_started: 'A storm has come in. Wind and heavy rain.',
  snow_started: 'It has started snowing.',
  you_were_attacked: 'Someone has hit you. It hurts.',
  you_collapsed: 'Your legs give way and you go down. You cannot get back up.',
  you_died: 'Everything goes quiet and far away, and then you stop feeling anything.',
  you_fell_ill: 'You have got sick. Your skin is hot and your arms and legs feel heavy.',
  you_were_infected: 'One of your wounds has gone bad. It is hot and the skin around it is red.',
  you_recovered: 'The sickness has passed. Your head is clear and your strength is coming back.',
  you_were_tended: 'Someone has treated your injuries. The pain is easing.',
  you_lost_them: 'You were following someone and lost them. You have stopped.',
  your_work_used_ate: 'Somebody ate what you caught or picked.',
  your_work_used_drank: 'Somebody drank from what you filled.',
  your_work_used_burned: 'Somebody warmed themselves at a fire you brought the wood for.',
  fire_ignited: 'You can smell smoke. Something nearby is on fire.',
  fire_spread: 'The fire is spreading and the smoke is getting thicker.',
  fire_extinguished: 'The smoke is clearing.',
  // The engine's table is the single copy of this prose; a mystery must read as
  // itself and never as the generic "something changed nearby" fallback.
  ...Object.fromEntries(
    MYSTERIES.filter((m) => m.scope === 'global').map((m) => [m.kind, m.prose]),
  ),
}

const UNKNOWN_FELT_PROSE = 'Something nearby has changed.'

// What ails a body, said as it feels and never as a number (G10). The alarm now wakes a mind
// for any of these, and a mind woken by poison has to be able to feel the poison.
const AFFLICTION_PROSE: Record<string, string> = {
  injury: 'An injury on your body is throbbing and you cannot ignore it.',
  poison: 'Your stomach is cramping. Something you ate has made you ill.',
  illness: 'You are sick. Your eyes feel hot and your arms and legs are heavy.',
  fatigue: 'You are tired in a way that sleep has not fixed.',
}

const AFFLICTION_SEVERE = 3

// The three things that can stand between a body and a cold night, each said as the body has
// it. They mirror `isExposed`'s own order, so the sentence and the law can never disagree.
const COLD_KEPT_OFF: Record<'walls' | 'coat' | 'fire', string> = {
  walls: 'It is cold outside. In here the walls are keeping it off you.',
  coat: 'It is cold, and what you are wearing is keeping it off you.',
  fire: 'It is cold, and the fire next to you is keeping it off you.',
}

const WEATHER_KIND_PROSE: Record<string, string> = {
  sunny: 'The sun is out.',
  cloudy: 'It is cloudy.',
  rain: 'It is raining steadily.',
  storm: 'There is a storm overhead.',
  snow: 'It is snowing.',
}

const NIGHT_WEATHER_KIND_PROSE: Record<string, string> = {
  sunny: 'The night sky is clear.',
  cloudy: 'It is cloudy tonight.',
  rain: 'It is raining in the dark.',
  storm: 'There is a storm tonight.',
  snow: 'It is snowing in the dark.',
}

function temperatureLine(temperatureC: number): string {
  if (temperatureC < 0) return 'The air is freezing.'
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
  return `It is ${weekdayFromTick(time.tick)}, day ${worldDay(time.tick)}, ${dayPhaseFromTick(time.tick)}, ${seasonPart(time.dayOfSeason)} ${time.season}.`
}
function footprintPhrase(w: number, h: number): string {
  if (w <= 1 && h <= 1) return 'one tile wide'
  return `${w} ${w === 1 ? 'tile' : 'tiles'} wide and ${h} ${h === 1 ? 'tile' : 'tiles'} tall`
}

// Answers about the world the packet cannot carry: whether ground is open to
// stand on, and whether a carried kind is food. Both come from the bridge.
/** What a material can be found as: a node still standing, a tree, or a stack somebody left. */
export type SourceKind = ForageableKind | 'tree' | 'stack'

/** A mark the walk verb resolves by name rather than by two numbers. */
export type WalkMark = { targetId: string } | { structureId: string }

export type ProseWorld = {
  isWalkable?: (x: number, y: number) => boolean
  // Whether the legs would really start for this mark, asked of the walk verb's own seam so a
  // target the prose offers is a target the world takes.
  canWalkTo?: (mark: WalkMark) => boolean
  // Whether a walk that names this place would end on the tile underfoot: the body is there.
  // r27's Nadia read "the river, close to the west" from its own bank and walked to it nine times.
  atPlace?: (id: string) => boolean
  // The nearest ground beside a spot that these legs can reach. Water and a well are both tiles
  // no foot can stand on, so the coordinates the roads name are not marks a walk can take.
  footingNear?: (x: number, y: number) => { x: number; y: number } | null
  isEdible?: (kind: string) => boolean
  // Where the water is. Nothing in the packet can say: terrain is the one thing perception
  // never projects, and block 1 now teaches two verbs that need it.
  waterAtHand?: () => boolean
  nearestWater?: (x: number, y: number) => { x: number; y: number } | null
  // Whether the act the world last turned away wanted water. A mind refused for water and told
  // nothing about water asks again: 79% of one run B mind's water refusals were the same reason
  // twice running, and its longest run was twenty-one.
  waterRefused?: () => boolean
  // Where the food is. The same answer thirst has had since the last batch, for the need that
  // never got one: the run that drank fifteen times ate once (R21).
  nearestFood?: (x: number, y: number) => { x: number; y: number; kind: string } | null
  // Who is out there. The same answer food and water have, for the last want that had none:
  // the low band said only that it was lonely.
  nearestPerson?: (x: number, y: number) => { x: number; y: number; name: string } | null
  // How warm this mind stands toward a person in sight, so a friend reads as a friend and not
  // as one more body at a bearing: r31's now-prose gave people 8 tokens in 600.
  warmthToward?: (id: string) => number
  // Where a material comes from. The same answer food and water have; wanting to build was the
  // only drive left with a cost and no place to go.
  nearestSource?: (
    kind: string,
    x: number,
    y: number,
  ) => { x: number; y: number; from: SourceKind } | null
  // Where a meal is got when none is stored: ground a foot can hold beside the water and beside
  // the woods. r26 ran its shelves bare on day 2 and twelve mouths talked about food for two
  // days without one of them knowing where to walk for it.
  foodSources?: (
    x: number,
    y: number,
  ) => { bank: { x: number; y: number } | null; woods: { x: number; y: number } | null }
  // Whether the night now coming is one the cold gets into. Read off the season's own band, so
  // a summer evening is never told to go for wood.
  nightWillBeCold?: () => boolean
  // Big water past the edge of sight, and null whenever any is already inside it. Terrain is the
  // one thing perception never projects, and a valley is mostly told by its water.
  distantWater?: (x: number, y: number) => { x: number; y: number } | null
  // How wide and how deep the valley is, in tiles.
  extent?: () => { w: number; h: number }
}

// Whether any tile ringing a structure's footprint can hold a body. A walk that names the place
// picks the tile itself, so all the sentence needs is whether there is one at all.
function openGroundBeside(
  s: { x: number; y: number; w: number; h: number },
  isWalkable: (x: number, y: number) => boolean,
): boolean {
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      const inside = x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h
      if (!inside && isWalkable(x, y)) return true
    }
  }
  return false
}

// Whether a body stands on the ring of tiles around a footprint, which is as near as a walk gets.
function touching(
  p: { x: number; y: number },
  s: { x: number; y: number; w: number; h: number },
): boolean {
  return p.x >= s.x - 1 && p.x <= s.x + s.w && p.y >= s.y - 1 && p.y <= s.y + s.h
}

// Whose it is and whose hands made it, in the order prose wants them. Empty for
// an unclaimed thing, so a town that owns nothing reads exactly as it always did.
function claimPhrase(i: PerceptionItem): string {
  const parts: string[] = []
  if (i.ownerName !== undefined) parts.push(`${i.ownerName}'s`)
  if (i.crafterMarkName !== undefined) parts.push(`marked by ${i.crafterMarkName}`)
  if (i.spoiling === true) parts.push('it is turning')
  return `${parts.length === 0 ? '' : `; ${parts.join(', ')}`}${markedPhrase(i.marks)}`
}

// What a minted verb wrote on a thing, as read by anyone who can see it: "marked: debt two planks".
function markedPhrase(marks: Record<string, string> | undefined): string {
  if (marks === undefined) return ''
  return Object.keys(marks)
    .sort()
    .map((k) => `; marked: ${k} ${marks[k]}`)
    .join('')
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
  if (r.atFire === true) conditions.push('at a fire someone is keeping fed')
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
  return `A ${words(w.kind)} is already going up at (${w.at.x}, ${w.at.y}): ${howFarUp({
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
      `What you know how to build, if you have the stuff and a place to put it: ${m.builds
        .map((b) => `a ${words(b.kind)} (${costPhrase(b.inputs)})`)
        .join(', ')}.`,
    )
    // "to begin a new one", never "to raise one": this ground is where a roof starts, and walls
    // that already stand are raised where they stand.
    if (groundForBuilding !== undefined && groundForBuilding !== null) {
      parts.push(
        `The town keeps ground for a new building at (${groundForBuilding.x}, ${groundForBuilding.y}). You have to be standing there to start one.`,
      )
    }
    // r32's Amara carried "the bridge once I find the right place" for two days: the kept
    // ground is inland, and nothing said a bridge is started from a bank.
    if (m.builds.some((b) => b.kind === 'bridge'))
      parts.push(
        'A bridge is the exception: it goes over water, started from the bank beside the spot you want it.',
      )
  }
  if (m.crafts.length > 0) {
    parts.push(
      `What you know how to make: ${m.crafts
        .map((c) => `${words(c.name)} (${c.roads.map(roadPhrase).join(', or ')})`)
        .join(', ')}.`,
    )
  }
  return parts.join(' ')
}

// The words a person uses for a thing they are making or mending. Nine of twelve r32 standing
// lines named a project (a net, a float, a bridge) and the arbiter saw two attempts in two days.
const PROJECT_WORDS =
  /\b(mak|mend|build|fix|repair|put(ting)? together|rais|shap|sew|weav|carv|patch|rig)/i

/** The goal that names a project, tied to the door it goes through: build or craft when the
 *  thing is on a list this mind knows, experiment when it is not. Empty when no goal is one. */
export function projectLine(goals: readonly string[], m: Makeables): string {
  const project = goals.find((g) => PROJECT_WORDS.test(g))
  if (project === undefined) return ''
  const listed = [...m.builds.map((b) => words(b.kind)), ...m.crafts.map((c) => words(c.name))]
  const named = listed.find((n) => project.toLowerCase().includes(n.toLowerCase()))
  const road =
    named === undefined
      ? 'It is on no list you know. Try it anyway: name it experiment and say what your hands do, one step at a time. The world answers.'
      : `That is on your list: ${named}. Make it now, with build or craft.`
  return `You said you are making something: "${project}" ${road} A thing talked about for two days and never touched is a thing you have given up on.`
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
  // Over-counting costs a redundant sentence; under-counting ranks a pot above a raisable roof.
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
    return fire === null ? '' : `; the hearth in ${placeSaid(fire)} (${fire.id}) is lit`
  }
  if (want.cond === 'water') {
    const w = world.nearestWater?.(packet.self.x, packet.self.y) ?? null
    return w === null ? '' : `; the nearest water is at (${w.x}, ${w.y})`
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
  return `${best.subject} needs ${best.want.say}${placeOf(best.want, packet, world)}.`
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
  const line = `Tonight will be cold. The hearth in ${placeSaid(near)} (${near.id}) is cold and needs wood.`
  // Hands that already hold the wood need no road to a tree, only the fire it is wanted at.
  if (packet.self.inventory.some((i) => i.kind === FUEL_ITEM)) return line
  const at = world?.nearestSource?.(FUEL_ITEM, packet.self.x, packet.self.y) ?? null
  if (at === null) return line
  return `${line} The nearest ${sourcePhrase(at.from, FUEL_ITEM)} is at (${at.x}, ${at.y}).`
}

/** A place a mind carries in its head: what it is called, if anything, and where it stands.
 *  A landmark nobody built is `natural`, and the block never lets the town's roofs crowd it out. */
export type KnownPlace = {
  id: string
  kind: string
  x: number
  y: number
  name?: string
  natural?: boolean
}

// One spelling of a place for the whole prompt: a named one is called by its name, an unnamed
// one is only ever pointed at. `words` keeps a lamp_post from reaching a mind with the underscore.
const placeSaid = (p: { kind: string; name?: string }): string => p.name ?? `a ${words(p.kind)}`

// Whose roof this is, said where the body is standing under it: courting takes a private roof of
// your own or theirs, and 31 of rehearsal 13's 42 ask refusals were that rule going unsaid.
const roofSaid = (i: { kind: string; yours?: true; ownerName?: string }): string =>
  i.ownerName !== undefined
    ? `${i.ownerName}'s ${words(i.kind)}`
    : i.yours === true
      ? `your own ${words(i.kind)}`
      : `the ${words(i.kind)}`
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

// Which way and how far, in one phrase: the places block and the water road say a distance the
// same way, or a mind is given two vocabularies for one valley.
const wayTo = (dx: number, dy: number): string => `${howFar(Math.hypot(dx, dy))} ${bearing(dx, dy)}`

// Where a thing in sight lies, said the way the places block says it. A named mark is what the
// walk verb takes, so the tile it used to be given here was only ever the easier thing to copy.
const inSight = (self: { x: number; y: number }, at: { x: number; y: number }): string =>
  at.x === self.x && at.y === self.y ? 'where you stand' : wayTo(at.x - self.x, at.y - self.y)

// Six is what a person holds in their head: the three landmarks, the shared roof, and the two
// nearest others. Rehearsal 29 read a sixteen-line gazetteer on 1417 of 1936 wakes.
const PLACES_SHOWN = 6

// The river, the rim and the storehouse are known by everyone and belong on the page wherever a
// body stands; the rest of the town is nearest first.
const anchored = (p: KnownPlace): boolean => (p.natural ?? false) || p.kind === 'storehouse'

/** Where this mind could go without seeing it first: everything it knows of that is not already
 *  in front of it, the anchored places first and then nearest first. A town of twelve roofs is
 *  twelve nearer things than the river, and sorting on distance alone drops the valley off the
 *  page. */
export function placesKnownLine(
  places: KnownPlace[],
  packet: PerceptionPacket,
  world?: ProseWorld,
): string {
  const inSight = new Set(packet.visible.structures.map((s) => s.id))
  const { x, y } = packet.self
  const lines = places
    .filter((p) => !inSight.has(p.id))
    .map((p) => ({ p, d: Math.hypot(p.x - x, p.y - y) }))
    .sort(
      (a, b) =>
        Number(anchored(b.p)) - Number(anchored(a.p)) || a.d - b.d || (a.p.id < b.p.id ? -1 : 1),
    )
    .slice(0, PLACES_SHOWN)
    .map(({ p }) =>
      world?.atPlace?.(p.id) === true
        ? `${placeSaid(p)} (${p.id}), right where you stand`
        : `${placeSaid(p)} (${p.id}), ${wayTo(p.x - x, p.y - y)}`,
    )
  return lines.length === 0 ? '' : `Places you know:\n${lines.join('\n')}`
}

/** ★ How far the ground goes, said once a turn above the places block. World three's Nadia walked
 *  at the east rim four times chasing bushes that were never there, and learned where the valley
 *  stopped only by being turned away at it. */
export function valleyExtentLine(world?: ProseWorld): string {
  const e = world?.extent?.()
  if (e === undefined) return ''
  return `The valley runs from (0, 0) to (${e.w - 1}, ${e.h - 1}). Past its edges there is only the road out.`
}

// Four names and six places is enough to choose from and short enough to stay a sentence. Each
// candidate costs the walk verb one search of the ground, so the caps are a budget as well.
const WALK_PEOPLE_SHOWN = 4
const WALK_PLACES_SHOWN = 6

/** ★ The marks these legs can actually take, every one of them put to the walk verb's own seam
 *  first. 61 of rehearsal 13's 178 refusals were a walk target the world could not resolve or
 *  reach: no path, no one by that name, or a body out of sight. Silent indoors, where the
 *  affordance line above already says the doorway is the only walk there is. */
export function walkTargetsLine(
  places: KnownPlace[],
  packet: PerceptionPacket,
  world?: ProseWorld,
): string {
  const can = world?.canWalkTo
  if (world === undefined || can === undefined || packet.self.inside !== undefined) return ''
  const { x, y } = packet.self
  const near = (p: { x: number; y: number }): number => Math.hypot(p.x - x, p.y - y)
  const order = (
    a: { id: string; x: number; y: number },
    b: { id: string; x: number; y: number },
  ) => near(a) - near(b) || (a.id < b.id ? -1 : 1)
  const marks: string[] = []
  for (const a of [...packet.visible.agents].sort(order)) {
    if (marks.length >= WALK_PEOPLE_SHOWN) break
    if (can({ targetId: a.id })) marks.push(`${a.name} (${a.id})`)
  }
  let shown = 0
  for (const p of [...places].sort(order)) {
    if (shown >= WALK_PLACES_SHOWN) break
    if (!can({ structureId: p.id })) continue
    marks.push(`${placeSaid(p)} (${p.id})`)
    shown++
  }
  marks.push(...walkableSources(packet, world))
  if (marks.length === 0) return ''
  return (
    `You can walk to any of these right now and your legs will find the way: ${marks.join(', ')}. ` +
    'Any other spot you name by two numbers may have no way through to it.'
  )
}

/** Where the three standing wants are, said as ground a foot can hold rather than as the water
 *  or the wall itself, which is the mark the roads above have always named. */
function walkableSources(packet: PerceptionPacket, world: ProseWorld): string[] {
  const footing = world.footingNear
  if (footing === undefined) return []
  const { x, y } = packet.self
  const said: string[] = []
  const offer = (at: { x: number; y: number } | null, what: string): void => {
    const on = at === null ? null : footing(at.x, at.y)
    if (on !== null) said.push(`(${on.x}, ${on.y}) for ${what}`)
  }
  offer(world.nearestWater?.(x, y) ?? null, 'water')
  const food = world.nearestFood?.(x, y) ?? null
  if (food !== null) offer(food, food.kind)
  offer(world.nearestSource?.(FUEL_ITEM, x, y) ?? null, FUEL_ITEM)
  return said
}

// Two tiles is the same spot: a step to the water butt and back is not a walk that went
// anywhere. Sixty ticks is one sim-hour, a hundred and eighty is three.
const STASIS_RADIUS = 2
const STASIS_TICKS = 60
const STASIS_LONG_TICKS = 180

/** Where a body has been standing, since when, and whether it has said anything there. */
export type Stillness = { x: number; y: number; sinceTick: number; spoke: boolean }

/** The count carries on while the feet stay inside the radius, and starts again the moment
 *  they leave it. The caller drops it to null when an act the world took changed something. */
export function stillnessAt(was: Stillness | null, x: number, y: number, tick: number): Stillness {
  if (was === null || Math.abs(x - was.x) > STASIS_RADIUS || Math.abs(y - was.y) > STASIS_RADIUS) {
    return { x, y, sinceTick: tick, spoke: false }
  }
  return was
}

/** The hour said as an hour. A fact about where the body has been, with no remedy in it: what
 *  to do about an afternoon spent standing is the mind's to work out. */
export function stasisLine(still: Stillness | null, tick: number): string {
  if (still === null) return ''
  const held = tick - still.sinceTick
  if (held < STASIS_TICKS) return ''
  const how = held >= STASIS_LONG_TICKS ? 'half the morning' : 'an hour'
  const words = still.spoke ? ', saying much the same things' : ''
  return `You have been in this same spot for ${how}${words}. Nothing has come of it.`
}

// r35: five minds spent an afternoon "letting him answer", one call an hour each and 28% of all
// turns, while the screen showed nothing. A wait is a decision nobody in the world can see.
export function silentTurnsLine(silentTurns: number): string {
  if (silentTurns < 2) return ''
  const times = silentTurns === 2 ? 'Twice' : 'Again and again'
  return `${times} now you have chosen to wait, and nothing came of it. Nobody can see you waiting.`
}

/** A fact about the hour and this body's own habit, for a mind still up and out past it. Under its
 *  own roof the reflex has already put it to bed; this reaches the one standing in the lane. */
export function bedtimeLine(packet: PerceptionPacket, bedHour: number, riseHour: number): string {
  if (packet.self.asleep || !packet.time.isNight) return ''
  const { hour } = packet.time
  if (hour < bedHour && hour >= riseHour) return ''
  return `It is past ${String(bedHour % 24).padStart(2, '0')}:00, the hour you usually turn in.`
}

/** Somebody this mind has a tie to, when it last had them in sight or earshot, and how warm
 *  the tie stood when they parted. Warmth is read at the parting, not now: a tie that decays
 *  while the two are apart would take the line away exactly as the absence grew long. */
export type Company = { name: string; lastSeenTick: number; warmth: number }

/** One line, or none. A roll-call of everybody out of sight is a list; the person most missed
 *  is a pull. Longest gone wins, then warmest, then the name, so two equal absences are stable. */
export function absenceLine(company: readonly Company[], tick: number): string {
  const missed = company
    .filter((c) => bondLevel(c.warmth) !== 'strangers' && tick - c.lastSeenTick >= MINUTES_PER_DAY)
    .sort(
      (a, b) =>
        a.lastSeenTick - b.lastSeenTick || b.warmth - a.warmth || (a.name < b.name ? -1 : 1),
    )[0]
  if (missed === undefined) return ''
  const days = Math.floor((tick - missed.lastSeenTick) / MINUTES_PER_DAY)
  return days === 1
    ? `You have not seen ${missed.name} since yesterday.`
    : `You have not seen ${missed.name} for ${days} days.`
}

/** Each want as a person would say it, never the table's word: r33's Salma, told her want was
 *  "affection", walked into Omar's house and said "Omar, I want affection now". */
export const WANT_SAID: Record<WantKind, string> = {
  belonging: 'to belong somewhere, to be one of them',
  affection: 'to be close to somebody',
  esteem: 'to be counted on',
  curiosity: 'to find something out',
  rivalry: 'to come out ahead of somebody',
  order: 'for things to be done properly',
  legacy: 'to leave something behind that lasts',
}

/** What this mind is shortest of, said once at the morning wake and nowhere else. It names a
 *  want and asks for a person, because a want with no road is worse than no want at all. */
export function wantLine(want: WantKind | null): string {
  if (want === null) return ''
  const head = `Today what you want most is ${WANT_SAID[want]}. Who could give you that?`
  // The one want with a verb behind it and no road in front of it: r32's mornings named
  // affection 33 times and nobody in 25 sim-days asked anyone to walk out. Names nobody.
  return want === 'affection'
    ? `${head} Walking out with somebody is how that starts: ask the person at your side, and they answer in their own time.`
    : head
}

// #region work as a social want

/** What the whole valley is holding, counted off the world and not off one pair of eyes. */
export type TownStock = { wood: number; food: number; hearths: number; mouths: number }

// A log burns a night at the live physics; two nights in hand is the least a stocked town holds.
const LOGS_PER_HEARTH = 2
// Two days of meals, the way the wood rule holds two nights: r25 ran the shelves from 41 meals to
// none in two days and no morning ever called them short.
const MEALS_PER_MOUTH = 2

/** The work each material comes out of, and how a body doing it is said. */
const WORK_SAID: Readonly<Record<'wood' | 'food', Readonly<Record<string, string>>>> = {
  wood: { chop: 'chopping' },
  food: { fish: 'fishing', forage: 'foraging', harvest: 'harvesting' },
}

const countOf = (n: number, word: string): string => `${n} ${n === 1 ? word : `${word}s`}`

const woodSaid = (s: TownStock): string =>
  `${countOf(s.wood, 'log')} for ${countOf(s.hearths, 'hearth')}`
const foodSaid = (s: TownStock): string =>
  `${countOf(s.food, 'meal')} for ${countOf(s.mouths, 'mouth')}`

const woodIsShort = (s: TownStock): boolean => s.wood < LOGS_PER_HEARTH * s.hearths
const foodIsShort = (s: TownStock): boolean => s.food < MEALS_PER_MOUTH * s.mouths

/** What the town is running out of, said flat to everybody in the morning and nowhere else.
 *  Only the short side, no urgency and nothing to do about it: r24 ran out on day 3 unseen. */
export function stockLine(stock: TownStock): string {
  const said: string[] = []
  if (woodIsShort(stock)) said.push(woodSaid(stock))
  if (foodIsShort(stock)) said.push(foodSaid(stock))
  return said.length === 0 ? '' : `The town has ${said.join(' and ')}.`
}

/** Whoever the eyes can already see at this work: nearest first, then by name so a tie is stable. */
function workerAtLine(packet: PerceptionPacket, short: 'wood' | 'food'): string {
  const said = WORK_SAID[short]
  const away = (p: { x: number; y: number }): number =>
    Math.abs(p.x - packet.self.x) + Math.abs(p.y - packet.self.y)
  const at = packet.visible.agents
    .map((a) => ({ a, doing: a.activityVerb === null ? undefined : said[a.activityVerb] }))
    .filter((w): w is { a: PerceptionAgent; doing: string } => w.doing !== undefined)
    .sort((p, q) => away(p.a) - away(q.a) || (p.a.name < q.a.name ? -1 : 1))[0]
  return at === undefined ? '' : `${at.a.name} is ${at.doing} at (${at.a.x}, ${at.a.y}).`
}

/** Who is at the work, or where the stuff stands when nobody is. */
function workRoadLine(
  short: 'wood' | 'food',
  packet: PerceptionPacket,
  world?: ProseWorld,
): string {
  const worker = workerAtLine(packet, short)
  if (worker.length > 0) return worker
  const { x, y } = packet.self
  if (short === 'wood') {
    const at = world?.nearestSource?.(FUEL_ITEM, x, y) ?? null
    return at === null
      ? ''
      : `The nearest ${sourcePhrase(at.from, FUEL_ITEM)} is at (${at.x}, ${at.y}).`
  }
  const at = world?.nearestFood?.(x, y) ?? null
  return at === null
    ? foodSourceRoad(packet, world)
    : `The nearest food you know of is ${at.kind} at (${at.x}, ${at.y}).`
}

/** Where food comes from when nobody has any: the bank and the wood's edge, each as ground a
 *  walk can end on. Places only; how long to stand there is the mind's to find out. */
function foodSourceRoad(packet: PerceptionPacket, world?: ProseWorld): string {
  const { x, y } = packet.self
  const at = world?.foodSources?.(x, y)
  if (at === undefined) return ''
  const said: string[] = []
  if (at.bank !== null)
    said.push(
      `Fish are in the river; the nearest bank to stand on is at (${at.bank.x}, ${at.bank.y}), ${wayTo(at.bank.x - x, at.bank.y - y)}.`,
    )
  if (at.woods !== null)
    said.push(
      `Berries grow at the edge of the woods; the nearest is at (${at.woods.x}, ${at.woods.y}), ${wayTo(at.woods.x - x, at.woods.y - y)}.`,
    )
  return said.join(' ')
}

/** Where the town is thin, and the road to it, for a mind that wants to be counted on. Never a
 *  quota and never an order: what the town is short of is a fact, what to do about it is yours. */
export function usefulLine(
  want: WantKind | null,
  stock: TownStock,
  packet: PerceptionPacket,
  world?: ProseWorld,
): string {
  if (want !== 'esteem') return ''
  const head = 'Today the thing you want most is to be counted on.'
  const wood = woodIsShort(stock)
  const food = foodIsShort(stock)
  if (!wood && !food) return `${head} Nobody is short of anything; who have you not helped lately?`
  const thinner =
    stock.wood / (LOGS_PER_HEARTH * stock.hearths) <= stock.food / (MEALS_PER_MOUTH * stock.mouths)
      ? 'wood'
      : 'food'
  const short = wood && food ? thinner : wood ? 'wood' : 'food'
  const said = `The town has ${short === 'wood' ? woodSaid(stock) : foodSaid(stock)}.`
  return [head, said, workRoadLine(short, packet, world)].filter((p) => p.length > 0).join(' ')
}

// #endregion

/** Said on every turn a mind is in a talk. The turn and the talk are two asks of the same mind,
 *  and r13 closed 49 of 106 talks because the turn walked off or went to bed without knowing. */
export function inTalkLine(withNames: readonly string[]): string {
  if (withNames.length === 0) return ''
  const them =
    withNames.length === 1
      ? withNames[0]!
      : `${withNames.slice(0, -1).join(', ')} and ${withNames.at(-1)}`
  return `You are in a conversation with ${them} right now. Stay where you are unless you have a reason to go: answer wait and keep talking. If you do leave, say so out loud first; ${them} will remember whether you walked off or said goodbye.`
}

/** How long a mind goes without anybody's company before the road out is worth saying. */
export const RESTLESS_DAYS = 6
/** How long the road stays open in the words of the one who took it before you. */
export const PARTNER_GONE_DAYS = 7
/** How many times the town has to see you break what it agreed, and inside how many days. */
export const SHUNNED_BREACHES = 3
export const SHUNNED_DAYS = 7

/** Why the road out is worth saying to this mind today. Nothing else is ever a reason: the
 *  verb is always there, and a mind with nothing wrong is never handed it. */
export type RoadCause =
  | { kind: 'restless'; days: number }
  | { kind: 'partner_gone'; name: string; days: number }
  | { kind: 'shunned'; times: number }

const daysAgo = (days: number): string =>
  days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`

/** The road out, said only where something stands behind it. Never a refusal and never advice:
 *  the way out of the valley is a fact about the world, and what to do with it is the mind's. */
export function roadOutLine(cause: RoadCause | null): string {
  if (cause === null) return ''
  if (cause.kind === 'restless') {
    return (
      `${cause.days} days now without anybody's company. You can leave the valley: name it` +
      ' leave_town and you walk out of it for good. Nothing here is stopping you.'
    )
  }
  if (cause.kind === 'partner_gone') {
    return (
      `${cause.name} left down the valley road ${daysAgo(cause.days)}.` +
      ' The road is still there. You could follow them: name it leave_town.'
    )
  }
  return (
    `${cause.times} times now the town has seen you break what it agreed.` +
    ' You can leave the valley: name it leave_town and you walk out of it for good.'
  )
}

// What "at the fire" means, in the tiles its own glow lights.
const GATHERING_RADIUS = 4

/** The fed fire at dusk and who is standing at it. A cue and not a summons: an empty fire is
 *  said too, because being the first one there is the answer a lonely mind is short of. */
export function gatheringLine(packet: PerceptionPacket, tick: number): string {
  if (dayPhaseFromTick(tick) !== 'dusk') return ''
  const fire = packet.visible.structures.find((s) => s.kind === 'fire_pit' && s.hearth === 'lit')
  if (fire === undefined) return ''
  const there = packet.visible.agents
    .filter(
      (a) =>
        !a.asleep && Math.max(Math.abs(a.x - fire.x), Math.abs(a.y - fire.y)) <= GATHERING_RADIUS,
    )
    .map((a) => a.name)
  const said = `${opening(placeSaid(fire))} (${fire.id}) is lit now that it is getting dark`
  if (there.length === 0) return `${said}, and nobody is standing at it.`
  if (there.length === 1) return `${said}; ${there[0]} is standing at it.`
  const who = `${there.slice(0, -1).join(', ')} and ${there.at(-1)}`
  return `${said}; ${who} are standing at it.`
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
  return s.hearth === 'lit' ? ' There is firelight inside it.' : ''
}

/** Said before the walk, not at the door: two roofs the same size are not the same night. From
 *  dusk, or in the room itself; a bed count on every house in sight at noon is no news. */
function bedClause(s: PerceptionStructure, isTheRoomYouAreIn: boolean, late: boolean): string {
  if (s.bed !== true) return ''
  if (isTheRoomYouAreIn) return ' There are beds in here.'
  return late ? ' There are beds in it.' : ''
}

// Renders mechanics as fiction. Every clause here states a fact and names no act — no remedy,
// no counsel, no comparison; the inference is the mind's.
/** One utterance, as the thing that was said rather than the moment it is read in. The recent
 *  window holds it for as long as it is recent, so the same key twice is one word, not two. */
export const heardKey = (h: { speakerId: string; text: string }): string =>
  `${h.speakerId}\u0000${h.text}`

const NOTHING_TOLD: ReadonlySet<string> = new Set()

/** Every utterance in earshot this ear has not been told yet, one per line. Kept out of the
 *  perception prose: a delimiter a speaker cannot write stops a forged attribution, and only
 *  separation stops a forged voice. Once a thing is said it stays said, so a line already told
 *  is not told again as though it were happening now. */
export function heardProse(
  packet: PerceptionPacket,
  told: ReadonlySet<string> = NOTHING_TOLD,
): string {
  return packet.heard
    .filter((h) => !told.has(heardKey(h)))
    .map((h) => heardLine(h.name, h.text))
    .join('\n')
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

// A tally of a kind and how many, which is how a shelf reads and how a satchel reads.
const tally = (t: { kind: string; qty: number }): string => `${t.kind} ×${t.qty}`

/** The satchel as a tally: one entry per kind, one mark, an ellipsis where more are behind it.
 *  A thing owned by another or turning keeps its own entry, so no claim is lost to the grouping. */
function heldPhrase(held: PerceptionItem[]): string {
  type Group = { kind: string; qty: number; id: string; claim: string; more: boolean }
  const groups = new Map<string, Group>()
  for (const i of held) {
    const claim = `${claimPhrase(i)}${i.text === undefined ? '' : `; it reads "${i.text}"`}`
    const at = groups.get(`${i.kind}${claim}`)
    if (at === undefined) {
      groups.set(`${i.kind}${claim}`, { kind: i.kind, qty: i.qty, id: i.id, claim, more: false })
    } else {
      at.qty += i.qty
      at.more = true
    }
  }
  return [...groups.values()]
    .map((g) => `${tally(g)} (${g.id}${g.more ? '…' : ''}${g.claim})`)
    .join(', ')
}

/** Whether these hands are at water, off the same test `drink`, `fill` and `fish` are refused
 *  by. Block 1 teaches all three as "standing beside water" and nothing said whether this body
 *  was: 105 of run B's 236 refusals were minds reaching for water on dry ground (rehearsal5). */
function waterRoad(packet: PerceptionPacket, thirst: number, world?: ProseWorld): string {
  if (world?.waterAtHand === undefined) return ''
  if (world.waterAtHand())
    return 'Water is within reach. You could drink here, or fill what you carry.'
  // Opened before the dryness is felt — thirst decays 1.67x slower than hunger, so the 30 both
  // once shared left the road 10 ticks of runway — and again the turn after the water is refused.
  if (thirst >= 50 && world.waterRefused?.() !== true) return ''
  const { x, y } = packet.self
  const w = world.nearestWater?.(x, y) ?? null
  if (w === null) return 'No water is within reach, and you do not know of any nearby.'
  return `No water is within reach. The nearest water you know of is at (${w.x}, ${w.y}), ${wayTo(w.x - x, w.y - y)}.`
}

/** Two sentences said before the turn is spent, each clause a fact the verbs decide by. Forty-four
 *  of run B's refusals were these facts going unsaid (rehearsal4). */
function affordanceLines(packet: PerceptionPacket): string[] {
  const { x, y } = packet.self
  const inside = packet.self.inside
  const lines: string[] = []

  if (inside === undefined) {
    const barred = (packet.reach?.noFooting ?? []).slice(0, NO_FOOTING_MAX)
    const walls =
      barred.length === 0
        ? ''
        : ` Wall or water covers ${barred.map((p) => `(${p.x}, ${p.y})`).join(', ')}, so you cannot walk there.`
    lines.push(
      `You are not inside anything, so there is nothing to step out of, and walking to (${x}, ${y}) gets you nowhere: you are already there.${walls}`,
    )
  } else {
    const door = packet.visible.structures.find((s) => s.id === inside.id)?.door
    const out =
      door === undefined
        ? 'you can see no way back out'
        : `the doorway at (${door.x}, ${door.y}) is the way back out`
    lines.push(
      `You are inside ${roofSaid(inside)} (${inside.id}). While you are in here you cannot walk anywhere or enter anything, and ${out}.`,
    )
  }

  const atHand = new Set(packet.reach?.atHand ?? [])
  const near = packet.visible.items.filter((i) => atHand.has(i.id))
  const held = packet.self.inventory
  let hands = held.length === 0 ? 'Your hands are empty' : `Your hands hold ${heldPhrase(held)}`
  // No `reach` at all is a packet composed before the block existed: it says nothing about
  // reach rather than claiming there is none.
  if (packet.reach !== undefined) {
    hands +=
      near.length === 0
        ? `; nothing${held.length === 0 ? '' : ' else'} is close enough to touch`
        : `; close enough to touch but not in your hands yet: ${near.map(itemPhrase).join(', ')}`
  }
  lines.push(`${hands}.`)
  return lines
}

// Roughly a token per 3.3 characters. A store is a standing fact said every turn, so a full
// storehouse is capped at a phrase rather than a page.
const STORE_MAX_CHARS = Math.floor(40 * 3.3)

// Sixty ticks is one sim-hour. A heap on the doorstep is a standing fact, and a standing fact
// said every turn is a fact a mind stops reading.
const DOORSTEP_QUIET_TICKS = 60

/** Your own things heaped against your own wall, said at most once an hour. `saidAtTick` is when
 *  this line last stood; null when it never has. */
export function doorstepLine(packet: PerceptionPacket, saidAtTick: number | null): string {
  const heap = packet.self.doorstep ?? []
  if (heap.length === 0) return ''
  if (saidAtTick !== null && packet.time.tick - saidAtTick < DOORSTEP_QUIET_TICKS) return ''
  return `On the ground by your door: ${heap.map(tally).join(', ')}.`
}

/** What one shelf holds, capped. The tail of a long one is a count of kinds: a mind deciding
 *  where to put a plank needs to know the barn is full, not to read the barn. */
function storeLine(s: PerceptionStore): string {
  const whose = s.ownerName === undefined ? (s.yours === true ? 'your' : 'the') : `${s.ownerName}'s`
  const said = s.name ?? `${whose} ${words(s.kind)}`
  const say = (n: number): string => {
    const left = s.items.length - n
    const tail = left === 0 ? '' : `, and ${left} other ${left === 1 ? 'kind' : 'kinds'}`
    return `${opening(said)} holds ${s.items.slice(0, n).map(tally).join(', ')}${tail}.`
  }
  let shown = 1
  while (shown < s.items.length && say(shown + 1).length <= STORE_MAX_CHARS) shown++
  return say(shown)
}

// What a tie is called to the person who holds it. Strangers and slight acquaintances get no
// word: a clause on every body would be the roll-call this line replaces.
const TIE_SAID: Readonly<Record<BondLevel, string>> = {
  hatred: ', who you cannot stand,',
  strained: ', who you are on bad terms with,',
  strangers: '',
  acquaintances: '',
  friendly: ', a friend,',
  close: ', a close friend,',
}

// What a body in sight is at, for the verbs a passer-by can read off it. A verb not here is
// said as nothing, never as its id.
const DOING_SAID: Readonly<Record<string, string>> = {
  chop: 'chopping wood',
  fish: 'fishing',
  forage: 'foraging',
  harvest: 'harvesting',
  till: 'working the soil',
  plant: 'planting',
  build: 'building',
  craft: 'making something',
  fill: 'filling a waterskin',
  stoke: 'feeding the fire',
  eat: 'eating',
  drink: 'drinking',
  write: 'writing',
  read: 'reading',
  tend: 'tending someone',
  teach: 'teaching',
  take: 'picking something up',
  stow: 'putting something away',
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
  const where = inside === undefined ? '' : ` inside ${roofSaid(inside)} (${inside.id})`
  lines.push(
    `You ${packet.self.asleep ? 'sleep' : packet.self.collapsed ? 'lie' : 'stand'}${where} at (${x}, ${y}).`,
  )
  lines.push(...affordanceLines(packet))

  // Who is here comes before how the body feels and long before what stands where: a mind reads
  // the top of its turn hardest, and r31's now-prose gave people one line in a hundred.
  for (const a of packet.visible.agents) {
    const tie = TIE_SAID[bondLevel(world?.warmthToward?.(a.id) ?? 0)]
    const doing = a.activityVerb === null ? undefined : DOING_SAID[a.activityVerb]
    const busy = doing === undefined ? '' : `, ${doing}`
    const dressed = a.worn === undefined ? '' : `, ${a.worn}`
    // Said last, because it is the thing a pair of eyes lands on: a body nobody can see is
    // ailing is a body nobody tends, and the live run tended nobody at all.
    const ails = a.condition === undefined ? '' : `, ${a.condition}`
    // Said first, because it is the thing a pair of eyes lands on FIRST: a face nobody in the
    // valley has seen before.
    const road = a.stranger === true ? ', a stranger who came up the valley road,' : ''
    const where = `${inSight(packet.self, a)}${dressed}${ails}${markedPhrase(a.marks)}`
    // Collapse before sleep: hunger goes on falling through the night, so a body that goes down
    // while sleeping is flagged both, and asleep-first told the town it was only resting.
    const who = `${a.name} (${a.id})${road}${tie}`
    if (a.collapsed)
      lines.push(
        `${who} lies collapsed ${where}. Hold food out to them and they will eat it from your hand.`,
      )
    else if (a.asleep) lines.push(`${who} sleeps ${where}.`)
    else lines.push(`${who} stands ${where}${busy}.`)
  }

  if (packet.self.collapsed)
    lines.push(
      'You have collapsed and cannot stand. You can still eat what is already in your hands, pick or take what is within reach, sleep, and drag yourself one tile. A fire, a roof or a bush one tile away is worth crawling to. Food, warmth and rest get you back on your feet.',
    )

  // What the body is already doing. A mind told it is standing still sets out again, and
  // again: one founder said she was leaving for the berries in forty-four turns (R21).
  if (packet.self.activity !== null && !packet.self.asleep) {
    const toward = packet.self.activityToward
    lines.push(
      toward === undefined
        ? `Your hands are busy. You are partway through ${packet.self.activity}, and it will finish before you can start anything else.`
        : packet.self.collapsed
          ? `You are already dragging yourself toward (${toward.x}, ${toward.y}). You will get there if you keep at it.`
          : `You are already walking toward (${toward.x}, ${toward.y}). You will get there if you keep going.`,
    )
  }

  // World one told five founders their stomachs ached on the exact tick they hit the floor: a
  // need fells at 5, so hunger and energy warn far above it. Thirst fells nobody and is left be.
  const { hunger, energy, warmth, social } = packet.self.body.needs
  const MEAL_DUE_HOURS = 20
  const MEAL_OVERDUE_HOURS = 40
  if (hunger < 25)
    lines.push(
      'You are starving and can think about little else. Eat today, wherever the food is and whoever it belongs to, or you will be on the ground before tomorrow.',
    )
  else if (hunger < 50) lines.push('You are hungry. You should eat before long.')
  // Appetite, not starvation: a meal a day is the town's rhythm, and the bar above only speaks
  // when days of meals have been missed. A packet from before appetite kept time says nothing.
  const sinceMeal = packet.self.body.hoursSinceMeal
  const mealDue = sinceMeal !== undefined && sinceMeal >= MEAL_DUE_HOURS
  if (mealDue && hunger >= 50) {
    lines.push(
      sinceMeal >= MEAL_OVERDUE_HOURS
        ? 'It is two days since you last ate. Eat today, and go back to a meal a day.'
        : 'It is a day since you last ate. A meal is due, and a meal is better with company.',
    )
  }
  // The same ladder hunger uses. A packet from before thirst existed reads as a full body.
  const thirst = packet.self.body.thirst ?? 100
  if (thirst < 5) lines.push('You are very thirsty and your throat hurts.')
  else if (thirst < 30) lines.push('Your mouth is dry.')
  if (energy < 10) lines.push('You are about to drop. You will fall asleep where you stand.')
  else if (energy < 30)
    lines.push('Your legs are shaking. You can barely stand and your eyes keep closing.')
  else if (energy < 45) lines.push('You are worn out.')
  if (warmth < 30) lines.push('You are shivering with cold.')
  // Where the cold is, and what stands between: the pair is the whole of what there is to learn.
  if (packet.cold !== undefined) {
    lines.push(
      'biting' in packet.cold
        ? 'The cold is getting into you out here.'
        : COLD_KEPT_OFF[packet.cold.keptOffBy],
    )
  }
  if (social < 30) lines.push('You feel lonely.')
  if (packet.self.body.hp < 30) lines.push('Your injuries ache.')
  if (packet.self.body.ill) lines.push('You have a fever and feel weak.')
  for (const a of packet.self.body.afflictions ?? []) {
    const prose = AFFLICTION_PROSE[a.kind]
    if (prose !== undefined)
      lines.push(a.severity >= AFFLICTION_SEVERE ? `${prose} It is very bad.` : prose)
  }

  const roads: string[] = []

  const water = waterRoad(packet, thirst, world)
  if (water.length > 0) roads.push(water)

  // The road thirst has had, given to the need that never had one. Hands first, then the
  // nearest thing worth walking to — and never as a refusal.
  if (hunger < 50 || mealDue) {
    const food =
      world?.isEdible === undefined
        ? undefined
        : packet.self.inventory.find((i) => world.isEdible!(i.kind))
    const f = food ? null : (world?.nearestFood?.(x, y) ?? null)
    // Hands and the nearest meal wait for real hunger or a due meal; the source road opens with
    // the first pang, because a body that has none and knows of none has a walk ahead of it.
    const pressing = hunger < 30 || mealDue
    if (food && pressing)
      roads.push(`You are carrying ${food.kind} (${food.id}). You could eat it now.`)
    else if (f !== null && pressing)
      roads.push(`The nearest food you know of is ${f.kind} at (${f.x}, ${f.y}).`)
    else if (!food && f === null) {
      const source = foodSourceRoad(packet, world)
      if (source.length > 0) roads.push(`No food you know of is left in the town. ${source}`)
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
  if (packet.light === 'dark') lines.push('It is dark here.')
  else if (packet.light === 'dim')
    lines.push(
      dayPhaseFromTick(packet.time.tick) === 'dawn'
        ? 'It is getting light.'
        : 'The light is going out of the day.',
    )
  else if (packet.light === 'bright' && packet.time.isNight)
    lines.push('A fire is lighting the ground around you.')

  // What the eyes catch at the far edge of the valley. A direction and nothing else: how far
  // and what it is worth are the mind's to work out.
  const glint = world?.distantWater?.(x, y) ?? null
  if (glint !== null)
    lines.push(`You can see water off to the ${bearing(glint.x - x, glint.y - y)}.`)

  // The physics, said plainly. What it is worth building here is not the ground's to say.
  if (packet.ground?.wellTravelled) lines.push('This spot is easy to reach on foot or by cart.')

  // The cost, said as it feels. Never a refusal, and never a number.
  if (packet.fumbling) lines.push('You fumble in the dark.')

  // Where the legs are going, and how far of it the body actually knows. Not a refusal.
  if (packet.wayUnclear) lines.push('You are not sure of the way from here.')

  // ★ Said on every turn the feet are there, not once on arriving: world three's Nadia stood on
  // column 75 four separate times and learned where the valley stopped only by being refused.
  if (packet.atRim)
    lines.push(
      'You are at the edge of the valley, where the road comes in. The town is up the road.',
    )

  // Beds are the night's question; the size of a roof is the builder's, and only while it rises.
  const late = packet.time.isNight || dayPhaseFromTick(packet.time.tick) === 'dusk'
  for (const s of packet.visible.structures) {
    const state = s.burning
      ? ', and it is burning'
      : s.stage === 'construction'
        ? `, and ${howFarUp(s.raised)}`
        : ''
    // ★ A DOORWAY IS A FACT, NOT A TILE. `enter` takes any ground within one of the door and a
    // walk that names the place is scored to land on exactly that ground, so the pair the line
    // used to carry bought nothing the name does not — and it was the easier thing to copy.
    let approach = 'walk to it and you end up beside it.'
    if (s.id === inside?.id) approach = 'this is the building you are in.'
    else if (s.door !== undefined) {
      // ★ FULL IS A FACT, NOT A REFUSAL. It names the doorway either way, so a mind can tell a
      // room that is full now from a wall with no way through it ever — and can come back.
      // At the door the walk is over: r24 spent 176 walks of no length on a door already reached,
      // and only 58 of them were followed by a step inside.
      const atDoor =
        inside === undefined &&
        Math.abs(packet.self.x - s.door.x) <= 1 &&
        Math.abs(packet.self.y - s.door.y) <= 1
      approach =
        s.full === true
          ? 'it has a doorway, and there is no room left inside.'
          : atDoor
            ? 'you are at its door; enter it and you are in.'
            : 'it has a doorway; walk to it and you can go in.'
    } else if (inside === undefined && touching(packet.self, s)) {
      // The same fact at a wall with no door. r26's Farida walked to a fire pit she stood
      // beside 37 times in 22 hours, told each time that a walk would put her beside it.
      approach = 'you are beside it now; there is nothing nearer to walk to.'
    } else if (world?.isWalkable && !openGroundBeside(s, world.isWalkable)) {
      approach = 'there is no open ground beside it.'
    }
    // Said at the wall instead of at the refusal: how far up the walls are never said that
    // there is nothing behind them yet.
    const hollow = s.stage === 'construction' ? ' There is no inside to it yet.' : ''
    const size = s.stage === 'construction' ? `, ${footprintPhrase(s.w, s.h)}` : ''
    lines.push(
      `${opening(placeSaid(s))} (${s.id}) stands ${inSight(packet.self, s)}${size}${state}; ${
        approach
      }${hollow}${hearthClause(s, s.id === inside?.id)}${bedClause(s, s.id === inside?.id, late)}${markedPhrase(s.marks)}`,
    )
  }

  // A thing already named as within reach is not named again here unless somebody's claim on
  // it is the news: r31 said each nearby item twice, and a third time as a walk.
  const atHand = new Set(packet.reach?.atHand ?? [])
  for (const i of packet.visible.items) {
    const claim = claimPhrase(i)
    if (atHand.has(i.id) && claim === '') continue
    const pos = i.loc.t === 'tile' ? ` ${inSight(packet.self, i.loc)}` : ''
    lines.push(`You can see ${itemPhrase(i)}${pos}${claim}.`)
  }

  for (const c of packet.visible.crops) {
    lines.push(
      `You can see ${c.kind} (${c.id}) at (${c.x}, ${c.y})${c.withered ? ', withered' : ''}.`,
    )
  }

  // Named, so a mind can point at one: `hunt` wants a faunaId and `forage` a nodeId, and
  // neither was ever nameable before.
  for (const f of packet.visible.fauna ?? []) {
    lines.push(`A ${f.kind} (${f.id}) is at (${f.x}, ${f.y}).`)
  }

  for (const n of packet.visible.forageables ?? []) {
    lines.push(`You see ${n.prose} (${n.id}) at (${n.x}, ${n.y}).`)
  }

  for (const s of packet.stores ?? []) if (s.items.length > 0) lines.push(storeLine(s))

  for (const s of packet.seen) {
    if (s.kind === 'item_taken')
      lines.push(`You see ${s.takerName} take ${s.ownerName}'s ${s.itemKind}.`)
    else if (s.kind === 'expression') {
      const doing = s.label ?? s.verb
      lines.push(
        s.sense === 'sound'
          ? `You hear ${s.actorName} ${doing}.`
          : `You see ${s.actorName} ${doing}.`,
      )
    } else if (s.kind === 'discovery') {
      // The saying is the inventor's own words for the attempt, reported: "he said he would…".
      const why = s.saying === undefined ? '' : `: ${s.pronoun} said ${s.pronoun} would ${s.saying}`
      lines.push(`${s.inventorName} has worked out ${s.name}${why}.`)
    } else if (s.kind === 'stranger_arrived') {
      lines.push(`You see ${s.name} come up the valley road.`)
    } else if (s.kind === 'law_broken') {
      lines.push(
        s.self
          ? `You broke what the town agreed: "${s.lawText}", and people saw you do it.`
          : `You see ${s.breakerName} break what the town agreed: "${s.lawText}".`,
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

// What a moment leaves behind, capped. A busy scene still fits under `GIST_MIN_CHARS`, so no
// night ever pays a call to shorten one of these rows.
const MEMORY_REACH_MAX = 8
const MEMORY_NEAR_MAX = 3
const MEMORY_HEARD_MAX = 2
const MEMORY_HEARD_CHARS = 120

/** The row a moment is remembered by: when and where the body was, who stood there, and the
 *  marks it could act on. The scenery is left out, because nothing ever reads it back. */
export function perceptionMemoryText(packet: PerceptionPacket): string {
  const { x, y } = packet.self
  const inside = packet.self.inside
  const where =
    inside === undefined ? `at (${x}, ${y})` : `inside ${roofSaid(inside)} (${inside.id})`
  const lines = [`${calendarLine(packet.time).replace(/\.$/, '')}, ${where}.`]

  const names = packet.visible.agents.map((a) => a.name)
  if (names.length > 0) lines.push(`With ${names.join(', ')}.`)

  const atHand = new Set(packet.reach?.atHand ?? [])
  const near = packet.visible.items.filter((i) => atHand.has(i.id))
  if (near.length > 0) {
    const more = near.length - MEMORY_REACH_MAX
    const said = near.slice(0, MEMORY_REACH_MAX).map(itemPhrase).join(', ')
    lines.push(`Within reach: ${said}${more > 0 ? `, and ${more} more` : ''}.`)
  }

  const around = packet.visible.structures
    .map((s) => ({ s, d: Math.hypot(s.x - x, s.y - y) }))
    .sort((a, b) => a.d - b.d || (a.s.id < b.s.id ? -1 : 1))
    .slice(0, MEMORY_NEAR_MAX)
  if (around.length > 0)
    lines.push(`Near: ${around.map(({ s }) => `${placeSaid(s)} (${s.id})`).join(', ')}.`)

  if (packet.self.inventory.length > 0) lines.push(`In hand: ${heldPhrase(packet.self.inventory)}.`)

  // A remark overheard outside any talk has no other row: two of them, so a passer-by's word
  // is not lost, and no more, so a loud square does not turn the row back into the prose.
  const heard = packet.heard.slice(0, MEMORY_HEARD_MAX)
  if (heard.length > 0)
    lines.push(
      `Heard: ${heard.map((h) => `${h.name} said "${h.text.slice(0, MEMORY_HEARD_CHARS)}"`).join('; ')}.`,
    )

  return lines.join(' ')
}
