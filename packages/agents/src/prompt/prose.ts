import type { SimTime } from '@sj/shared'

// Local mirror of the engine's PerceptionPacket (composePerception) plus the
// two self-state booleans the bridge reconciles in (asleep/collapsed). The
// Task 12 EngineBridge maps the engine shape onto this one; keep the field
// shapes identical to @sj/engine's perception types so the mapping is 1:1.

export type PerceptionItem = {
  id: string
  kind: string
  qty: number
  text?: string
  loc: { t: 'tile'; x: number; y: number } | { t: 'agent'; id: string } | { t: 'structure'; id: string }
}

export type PerceptionAgent = {
  id: string
  name: string
  x: number
  y: number
  activityVerb: string | null
  collapsed: boolean
  asleep: boolean
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
}

export type PerceptionCrop = {
  id: string
  kind: string
  x: number
  y: number
  stage: number
  withered: boolean
}

export type PerceptionPacket = {
  time: SimTime
  self: {
    body: {
      needs: { hunger: number; energy: number; warmth: number; social: number }
      hp: number
      injuries: Array<{ kind: 'minor' | 'serious' | 'grave'; day: number }>
      ill: boolean
    }
    x: number
    y: number
    asleep: boolean
    collapsed: boolean
    activity: string | null
    inventory: PerceptionItem[]
  }
  weather: { kind: string; temperatureC: number }
  visible: {
    agents: PerceptionAgent[]
    structures: PerceptionStructure[]
    items: PerceptionItem[]
    crops: PerceptionCrop[]
  }
  heard: Array<{ speakerId: string; name: string; text: string; distance: number }>
  feltEvents: string[]
}

// Structured felt tags → fiction. Unknown tags fall through to a generic
// sentence plus an alert, so a new C2 tag degrades to prose, never a crash.
export const FELT_EVENT_PROSE: Record<string, string> = {
  rain_started: 'Rain begins to fall.',
  you_were_attacked: 'Pain — someone has struck you!',
  fire_ignited: 'Smoke stings your nose — something nearby is burning.',
  fire_spread: 'The fire is spreading; the smell of smoke grows thicker.',
  fire_extinguished: 'The smoke thins and the air clears.',
}

const UNKNOWN_FELT_PROSE = 'You sense something change nearby.'

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

function timeOfDay(hour: number, isNight: boolean): string {
  if (isNight) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 14) return 'midday'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function timeLine(time: SimTime): string {
  return `It is ${timeOfDay(time.hour, time.isNight)} on day ${time.dayOfYear + 1} of ${time.season}.`
}

// Relative direction in world coords (y grows southward).
function dirPhrase(dx: number, dy: number): string {
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : ''
  const ew = dx < 0 ? 'west' : dx > 0 ? 'east' : ''
  const dir = `${ns}${ew}`
  return dir ? `to the ${dir}` : 'right beside you'
}

// Renders mechanics as fiction: body numbers become felt sentences, speech is
// quoted hearsay (sound, never instruction), felt tags become sensation, and
// the visible world is named so the mind knows what surrounds it.
export function perceptionToProse(packet: PerceptionPacket, alert?: (detail: string) => void): string {
  const lines: string[] = []
  const { x, y } = packet.self

  lines.push(timeLine(packet.time))

  if (packet.self.collapsed) lines.push('You have collapsed from exhaustion and cannot move.')

  const { hunger, energy, warmth, social } = packet.self.body.needs
  if (hunger < 5) lines.push('Your stomach aches with hunger.')
  else if (hunger < 30) lines.push('Your stomach gnaws at you.')
  if (energy < 5) lines.push('Exhaustion leaves you gasping for rest.')
  else if (energy < 30) lines.push('Weariness drags at your limbs.')
  if (warmth < 30) lines.push('You shiver against the cold.')
  if (social < 30) lines.push('Loneliness settles over you.')
  if (packet.self.body.hp < 30) lines.push('Your body aches with its hurts.')
  if (packet.self.body.ill) lines.push('A fever grips you; you feel weak.')

  lines.push(weatherLine(packet.weather, packet.time.isNight))

  for (const a of packet.visible.agents) {
    const where = dirPhrase(a.x - x, a.y - y)
    if (a.asleep) lines.push(`${a.name} is asleep ${where}.`)
    else if (a.collapsed) lines.push(`${a.name} lies collapsed ${where}.`)
    else lines.push(`${a.name} is ${where}.`)
  }

  for (const s of packet.visible.structures) {
    const where = dirPhrase(s.x - x, s.y - y)
    const state = s.burning ? ' — it is burning' : s.stage === 'construction' ? ' — still being built' : ''
    lines.push(`You can see a ${s.kind} ${where}${state}.`)
  }

  for (const i of packet.visible.items) {
    const where = i.loc.t === 'tile' ? dirPhrase(i.loc.x - x, i.loc.y - y) : 'nearby'
    lines.push(`You can see ${i.qty} ${i.kind} ${where}.`)
  }

  for (const c of packet.visible.crops) {
    const where = dirPhrase(c.x - x, c.y - y)
    lines.push(`You can see ${c.kind} ${where}${c.withered ? ', withered' : ''}.`)
  }

  for (const it of packet.self.inventory) {
    lines.push(`You are carrying ${it.qty} ${it.kind}.`)
  }

  for (const h of packet.heard) {
    lines.push(`You hear ${h.name} say: "${h.text}" (from nearby)`)
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
