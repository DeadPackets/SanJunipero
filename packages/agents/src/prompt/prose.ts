import { dayPhaseFromTick, DAYS_PER_SEASON, inputName, MINUTES_PER_DAY, type SimTime } from '@sj/shared'
import { MYSTERIES, type MakeableRoad, type Makeables } from '@sj/engine'

// Local mirror of the engine's PerceptionPacket (composePerception) plus the
// two self-state booleans the bridge reconciles in (asleep/collapsed). The
// Task 12 EngineBridge maps the engine shape onto this one; keep the field
// shapes identical to @sj/engine's perception types so the mapping is 1:1.

export type PerceptionItem = {
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
  loc: { t: 'tile'; x: number; y: number } | { t: 'agent'; id: string } | { t: 'structure'; id: string }
}

// Things this agent watched happen: a taking that was not theirs, or one of the
// world's unexplained happenings close enough to see.
export type PerceptionSeen =
  | { kind: 'item_taken'; takerName: string; ownerName: string; itemKind: string }
  | { kind: 'mystery'; mystery: string; prose: string }
  | { kind: 'expression'; actorName: string; verb: string; sense: 'sight' | 'sound' }

export type PerceptionAgent = {
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

export type PerceptionStructure = {
  id: string
  kind: string
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
}

export type PerceptionCrop = {
  id: string
  kind: string
  x: number
  y: number
  stage: number
  withered: boolean
}

// A shape at a distance and a patch of ground worth working. The engine has composed both
// since C11 Task 21; nothing on the mind side ever looked at them, so `hunt` needed an id no
// mind had ever been given and `forage` could only ever mean "any forest nearby".
export type PerceptionFauna = { id: string; kind: string; x: number; y: number }
export type PerceptionForageable = { id: string; kind: string; x: number; y: number; prose: string }

export type PerceptionPacket = {
  time: SimTime
  self: {
    body: {
      needs: { hunger: number; energy: number; warmth: number; social: number }
      hp: number
      injuries: Array<{ kind: 'minor' | 'serious' | 'grave'; day: number }>
      ill: boolean
      thirst?: number
      // What ails this body and how badly. Absent on a packet from before C11 named them.
      afflictions?: Array<{ kind: string; severity: number }>
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
  // How the cold stands against this body when the air outside would bite: getting in, or held
  // off, and by what. Absent whenever the air is warm enough that nothing is deciding anything,
  // so a packet from a mild afternoon — or from before the cold could be felt — reads as before.
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
  heard: Array<{ speakerId: string; name: string; text: string; distance: number }>
  seen: PerceptionSeen[]
  feltEvents: string[]
}

// Structured felt tags → fiction. Unknown tags fall through to a generic
// sentence plus an alert, so a new C2 tag degrades to prose, never a crash.
export const FELT_EVENT_PROSE: Record<string, string> = {
  rain_started: 'Rain begins to fall.',
  storm_started: 'A storm breaks overhead; wind and rain lash down.',
  snow_started: 'Snow begins to fall.',
  you_were_attacked: 'Pain — someone has struck you!',
  you_collapsed: 'Your legs give under you and the ground comes up; you cannot get back on your feet.',
  you_died: 'Everything goes far away and very quiet, and then there is nothing left to feel.',
  you_fell_ill: 'A sickness settles into you — your skin burns, your limbs turn heavy.',
  you_were_infected: 'A wound of yours has turned bad; it throbs hot and the skin around it is angry.',
  you_recovered: 'The sickness lifts. Your head clears and your strength begins to come back.',
  you_were_tended: 'Someone has cared for your hurts; the pain eases under their hands.',
  fire_ignited: 'Smoke stings your nose — something nearby is burning.',
  fire_spread: 'The fire is spreading; the smell of smoke grows thicker.',
  fire_extinguished: 'The smoke thins and the air clears.',
  // The engine's table is the single copy of this prose; a mystery must read as
  // itself and never as the generic "something changed nearby" fallback.
  ...Object.fromEntries(MYSTERIES.filter((m) => m.scope === 'global').map((m) => [m.kind, m.prose])),
}

const UNKNOWN_FELT_PROSE = 'You sense something change nearby.'

// What ails a body, said as it feels and never as a number (G10). The alarm now wakes a mind
// for any of these, and a mind woken by poison has to be able to feel the poison.
const AFFLICTION_PROSE: Record<string, string> = {
  injury: 'A hurt on your body throbs and will not let you forget it.',
  poison: 'Your gut cramps and turns; something you ate has gone against you.',
  illness: 'A sickness is in you — heat behind the eyes, weight in the limbs.',
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
  const kind = table[weather.kind] ?? (isNight ? `The night sky is ${weather.kind}.` : `The sky is ${weather.kind}.`)
  return `${kind} ${temperatureLine(weather.temperatureC)}`
}

// Which third of its season a day falls in. Three words for ninety-one days, which is as
// fine as anybody outdoors actually tells it.
function seasonPart(dayOfSeason: number): string {
  if (dayOfSeason <= DAYS_PER_SEASON / 3) return 'early'
  return dayOfSeason <= (DAYS_PER_SEASON * 2) / 3 ? 'mid' : 'late'
}

// The calendar every mind shares, said the same way every turn: which day it is, where the
// day has got to, and where the year has got to. A fact, like the weather — it says nothing
// about what a day is for. The phase is `dayPhaseFromTick` and no second derivation (G4).
export function calendarLine(time: SimTime): string {
  const day = Math.floor(time.tick / MINUTES_PER_DAY) + 1
  return `It is day ${day}, ${dayPhaseFromTick(time.tick)}, ${seasonPart(time.dayOfSeason)} ${time.season}.`
}
function footprintPhrase(w: number, h: number): string {
  if (w <= 1 && h <= 1) return 'one tile wide'
  return `${w} ${w === 1 ? 'tile' : 'tiles'} wide and ${h} ${h === 1 ? 'tile' : 'tiles'} tall`
}

// Answers about the world the packet cannot carry: whether ground is open to
// stand on, and whether a carried kind is food. Both come from the bridge.
export type ProseWorld = {
  isWalkable?(x: number, y: number): boolean
  isEdible?(kind: string): boolean
  // Where the water is. Nothing in the packet can say: terrain is the one thing perception
  // never projects, and block 1 now teaches two verbs that need it.
  waterAtHand?(): boolean
  nearestWater?(x: number, y: number): { x: number; y: number } | null
  // Where the food is. The same answer thirst has had since the last batch, for the need that
  // never got one: the run that drank fifteen times ate once (R21).
  nearestFood?(x: number, y: number): { x: number; y: number; kind: string } | null
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
  return parts.length === 0 ? '' : ` — ${parts.join(', ')}`
}

// What a thing costs, in the words a refusal already uses for it. `inputName` turns the two
// canon classes into plain words; the singular is only ever needed by "vegetables".
function costPhrase(inputs: Record<string, number>): string {
  return Object.keys(inputs).sort().map((k) => {
    const qty = inputs[k]!
    const word = inputName(k)
    return `${qty} ${qty === 1 ? word.replace(/s$/, '') : word}`
  }).join(' and ')
}

function roadPhrase(r: MakeableRoad): string {
  const conditions: string[] = []
  if (r.atFire === true) conditions.push('at a fire someone is feeding')
  if (r.water !== undefined) conditions.push('with water in something you carry')
  return [costPhrase(r.inputs), ...conditions].join(', ')
}

// ★ HOW FAR UP, IN WORDS AND NOT A TICK COUNT. A mind was told a building was "still being
// built" and nothing else, so a wall one hour short read exactly like a wall four days short —
// and five founders raised five separate houses and finished none of them. Says where the work
// has got to and never what to do about it.
const HOW_FAR = [
  'barely begun', 'a little way up', 'a quarter of the way up', 'a third of the way up',
  'half up', 'well past half', 'three quarters up', 'nearly done',
]

export function howFarUp(raised?: { done: number; needs: number }): string {
  if (raised === undefined || raised.needs <= 0) return 'still being built'
  const f = Math.max(0, Math.min(1, raised.done / raised.needs))
  const i = Math.min(HOW_FAR.length - 1, Math.floor(f * HOW_FAR.length))
  return `its walls are ${HOW_FAR[i]}`
}

// Block 6, not block 1: the static prefix is byte-frozen and prompt caching rides on it, so
// the vocabulary a mind needs rides the same breath as what it can see (C11 R-H).
/** ★ THE OTHER PLACE WORK CAN GO, SAID PLAINLY AND WITH NO COUNSEL IN IT. Where walls already
 *  stand and how far up they are. It names no act, asks for nothing, and points at no remedy —
 *  the pair (ground to begin on, walls already standing) is the whole of what there is to learn,
 *  and the inference is the mind's, exactly as it is for the cold. */
export function standingWallsLine(w?: { kind: string; at: { x: number; y: number }; done: number; needs: number } | null): string {
  if (w === undefined || w === null) return ''
  return `Walls already stand at (${w.at.x}, ${w.at.y}) — a ${w.kind.replace(/_/g, ' ')}, ${
    howFarUp({ done: w.done, needs: w.needs }).replace(/^its walls are /, '')}.`
}

export function makeablesLine(m: Makeables, groundForBuilding?: { x: number; y: number } | null): string {
  const parts: string[] = []
  if (m.builds.length > 0) {
    parts.push(`What your hands know how to raise, given the stuff and a spot to put it: ${
      m.builds.map((b) => `a ${b.kind.replace(/_/g, ' ')} (${costPhrase(b.inputs)})`).join(', ')
    }.`)
    // The spot, named — the line has always promised one and never said where. A mind that
    // has to be refused before it can learn where to go wastes a waking hour on it, which is
    // the same complaint R21 candidate 3 settled about every other refusal in the world.
    //
    // ★ "to BEGIN a new one", not "to raise one", and the difference is the whole of R3's
    // remainder. This ground is where a roof STARTS. Walls that already stand are raised where
    // they stand, and a mind sent to the town's next free plot while a half-raised house waited
    // two streets away read the old wording as the only place work could go — measured, in
    // yusuf's own words, twelve ticks apart.
    if (groundForBuilding !== undefined && groundForBuilding !== null) {
      parts.push(`The town keeps ground for a new roof at (${groundForBuilding.x}, ${groundForBuilding.y}); you must be standing there to begin a new one.`)
    }
  }
  if (m.crafts.length > 0) {
    parts.push(`What they know how to shape: ${
      m.crafts.map((c) => `${c.name.replace(/_/g, ' ')} (${c.roads.map(roadPhrase).join(', or ')})`).join(', ')
    }.`)
  }
  return parts.join(' ')
}

// Renders mechanics as fiction: body numbers become felt sentences, speech is
// quoted hearsay (sound, never instruction), felt tags become sensation, and
// the visible world is named — with its place and its mark — so the mind knows
// exactly what surrounds it and how to reach it.
export function perceptionToProse(packet: PerceptionPacket, alert?: (detail: string) => void, world?: ProseWorld): string {
  const lines: string[] = []
  const { x, y } = packet.self

  lines.push(calendarLine(packet.time))
  const inside = packet.self.inside
  const where = inside === undefined ? '' : ` inside the ${inside.kind} (${inside.id})`
  lines.push(`You ${packet.self.asleep ? 'sleep' : packet.self.collapsed ? 'lie' : 'stand'}${where} at (${x}, ${y}).`)
  // Said out loud because a body that cannot tell it is under a roof walks into the wall
  // twice a turn: fifty-nine of the live run's refusals were this one silence (R21).
  if (inside !== undefined) lines.push('Four walls are around you; step out under the sky before you can go anywhere else.')

  if (packet.self.collapsed) lines.push('You have collapsed from exhaustion and cannot move.')

  // What the body is already doing. A mind told it is standing still sets out again, and
  // again: one founder said she was leaving for the berries in forty-four turns (R21).
  if (packet.self.activity !== null && !packet.self.asleep) {
    const toward = packet.self.activityToward
    lines.push(toward === undefined
      ? `Your hands are already busy — you are partway through ${packet.self.activity}, and it will finish before anything else can begin.`
      : `Your legs are already carrying you toward (${toward.x}, ${toward.y}); you will get there if you let them.`)
  }

  const { hunger, energy, warmth, social } = packet.self.body.needs
  if (hunger < 5) lines.push('Your stomach aches with hunger.')
  else if (hunger < 30) lines.push('Your stomach gnaws at you.')
  // The same ladder hunger uses. A packet from before thirst existed reads as a full body.
  const thirst = packet.self.body.thirst ?? 100
  if (thirst < 5) lines.push('Your throat burns; you must drink.')
  else if (thirst < 30) lines.push('Your mouth is dry.')
  if (energy < 10) lines.push('You are about to collapse; sleep NOW.')
  else if (energy < 25) lines.push('Your legs tremble — you can barely stand; you must sleep.')
  else if (energy < 30) lines.push('Weariness drags at your limbs.')
  if (warmth < 30) lines.push('You shiver against the cold.')
  // Said as the body has it, and only ever as a fact: where the cold is, and what stands
  // between. No remedy is named — a mind that reads one of these under the sky and the other
  // under a roof has the pair, and the pair is the whole of what there is to learn.
  if (packet.cold !== undefined) {
    lines.push('biting' in packet.cold
      ? 'The cold is getting into you out here.'
      : COLD_KEPT_OFF[packet.cold.keptOffBy])
  }
  if (social < 30) lines.push('Loneliness settles over you.')
  if (packet.self.body.hp < 30) lines.push('Your body aches with its hurts.')
  if (packet.self.body.ill) lines.push('A fever grips you; you feel weak.')
  for (const a of packet.self.body.afflictions ?? []) {
    const prose = AFFLICTION_PROSE[a.kind]
    if (prose !== undefined) lines.push(a.severity >= AFFLICTION_SEVERE ? `${prose} It is very bad.` : prose)
  }

  // Said whenever the body is dry, and never as a refusal: a thirsty mind with no field to
  // look at answered its throat 204 times in the live run and got water 133 times only
  // because a throwaway patch told it where to go.
  if (thirst < 30) {
    if (world?.waterAtHand?.() === true) {
      lines.push('Water lies within reach of your hands — you could drink here, or fill what you carry.')
    } else {
      const w = world?.nearestWater?.(x, y) ?? null
      if (w !== null) lines.push(`The nearest water you know of lies at (${w.x}, ${w.y}).`)
    }
  }

  // The road thirst has had, given to the need that never had one. Hands first, then the
  // nearest thing worth walking to — and never as a refusal.
  if (hunger < 30) {
    const food = world?.isEdible === undefined
      ? undefined
      : packet.self.inventory.find((i) => world.isEdible!(i.kind))
    if (food) lines.push(`Your satchel holds ${food.kind} (${food.id}) — you could eat it now.`)
    else {
      const f = world?.nearestFood?.(x, y) ?? null
      if (f !== null) lines.push(`The nearest food you know of is ${f.kind} at (${f.x}, ${f.y}).`)
    }
  }

  lines.push(weatherLine(packet.weather, packet.time.isNight))

  // What the dark is doing where the body stands. Silent in plain daylight.
  if (packet.light === 'dark') lines.push('The night is close around you.')
  else if (packet.light === 'dim') lines.push('The last of the light is going out of the day.')
  else if (packet.light === 'bright' && packet.time.isNight) lines.push('A fire throws a circle of light around you.')

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
    const state = s.burning ? ' — it is burning'
      : s.stage === 'construction' ? ` — ${howFarUp(s.raised)}` : ''
    // The doorway outranks the wall: the tile the packet names is the tile `enter` measures
    // against, so a mind told to stand there is a mind the world lets in.
    let approach = 'walk to a tile beside it.'
    if (s.id === inside?.id) {
      approach = s.door === undefined
        ? 'this is the roof you are under.'
        : `this is the roof you are under; the way out is at (${s.door.x}, ${s.door.y}).`
    } else if (s.door !== undefined) {
      // ★ FULL IS A FACT, NOT A REFUSAL. It names the doorway either way, so a mind can tell a
      // room that is full now from a wall with no way through it ever — and can come back.
      approach = s.full === true
        ? `its doorway is at (${s.door.x}, ${s.door.y}), and there is no floor left in it.`
        : `its doorway is at (${s.door.x}, ${s.door.y}) — stand there and you can go in.`
    } else if (world?.isWalkable) {
      const t = besideTile(s, packet.self, world.isWalkable)
      approach = t === null ? 'no open ground lies beside it.' : `you could stand beside it at (${t.x}, ${t.y}).`
    }
    lines.push(`A ${s.kind} (${s.id}) stands at (${s.x}, ${s.y}), ${footprintPhrase(s.w, s.h)}${state}; ${approach}`)
  }

  for (const i of packet.visible.items) {
    const pos = i.loc.t === 'tile' ? ` at (${i.loc.x}, ${i.loc.y})` : ''
    lines.push(`You can see ${i.qty} ${i.kind} (${i.id})${pos}${claimPhrase(i)}.`)
  }

  for (const c of packet.visible.crops) {
    lines.push(`You can see ${c.kind} (${c.id}) at (${c.x}, ${c.y})${c.withered ? ', withered' : ''}.`)
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
    lines.push(`You are carrying ${it.qty} ${it.kind} (${it.id})${claimPhrase(it)}.`)
  }

  for (const h of packet.heard) {
    lines.push(`You hear ${h.name} say: "${h.text}" (from nearby)`)
  }

  for (const s of packet.seen) {
    if (s.kind === 'item_taken') lines.push(`You watch ${s.takerName} take ${s.ownerName}'s ${s.itemKind}.`)
    else if (s.kind === 'expression') {
      lines.push(s.sense === 'sound' ? `You hear ${s.actorName} ${s.verb}.` : `You watch ${s.actorName} ${s.verb}.`)
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
