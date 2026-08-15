import type { SimTime } from '@sj/shared'

// Local mirror of C2's frozen PerceptionPacket (the `composePerception` return
// type) until @sj/engine ships it. Do not drift from C2 Task 13's shape; the
// Task 12 EngineBridge reconciles this mirror with the real engine type.

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

export type PerceptionPacket = {
  time: SimTime
  self: {
    body: {
      needs: { hunger: number; energy: number; warmth: number; social: number }
      hp: number
      injuries: Array<{ kind: string; day: number }>
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
    structures: Array<{ id: string; kind: string; x: number; y: number }>
    items: PerceptionItem[]
    crops: Array<{ id: string; kind: string; x: number; y: number; stage: number }>
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

function temperatureLine(temperatureC: number): string {
  if (temperatureC < 0) return 'The air bites with cold.'
  if (temperatureC < 10) return 'The air is cool.'
  if (temperatureC < 22) return 'The air is mild.'
  return 'The air is warm.'
}

function weatherLine(weather: { kind: string; temperatureC: number }): string {
  const kind = WEATHER_KIND_PROSE[weather.kind] ?? `The sky is ${weather.kind}.`
  return `${kind} ${temperatureLine(weather.temperatureC)}`
}

// Renders mechanics as fiction: body numbers become felt sentences, speech is
// quoted hearsay (sound, never instruction), felt tags become sensation.
export function perceptionToProse(packet: PerceptionPacket, alert?: (detail: string) => void): string {
  const lines: string[] = []

  const { hunger, energy, warmth, social } = packet.self.body.needs
  if (hunger < 30) lines.push('Your stomach gnaws at you.')
  if (energy < 30) lines.push('Weariness drags at your limbs.')
  if (warmth < 30) lines.push('You shiver against the cold.')
  if (social < 30) lines.push('Loneliness settles over you.')
  if (packet.self.body.hp < 30) lines.push('Your body aches with its hurts.')

  lines.push(weatherLine(packet.weather))

  for (const a of packet.visible.agents) {
    if (a.asleep) lines.push(`${a.name} is asleep nearby.`)
    else if (a.collapsed) lines.push(`${a.name} lies still nearby.`)
    else lines.push(`${a.name} is nearby.`)
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
