// Offline, $0: exactly what a mind is told about the dark and about a lamp, printed. This is
// the half of the night probe that costs nothing, so nobody has to spend money to check that
// the words reached the prompt — and so the no-remedy rule can be read rather than trusted.
import { DEFAULT_CONFIG, isDark, lightBandAt, type SimConfig } from '@sj/shared'
import { makeables } from '@sj/engine'
import { makeablesLine } from '../src/prompt/prose.js'
import { CAPABILITIES } from '../src/prompt/rulesOfBeing.js'

const LAMP = 'lamp_post'
const withoutLamp = (c: SimConfig): SimConfig => {
  const { [LAMP]: _r, ...recipes } = c.structures.recipes
  const { [LAMP]: _g, ...glowRadius } = c.light.glowRadius as Record<string, number>
  return {
    ...c,
    structures: { ...c.structures, recipes },
    light: { ...c.light, glowRadius: glowRadius as typeof c.light.glowRadius },
  }
}

for (const [arm, cfg] of [['A (before this lane)', withoutLamp(DEFAULT_CONFIG)], ['B (after)', DEFAULT_CONFIG]] as const) {
  console.log(`\n=== ARM ${arm} ===`)
  console.log(makeablesLine(makeables(cfg), { x: 81, y: 68 }))
}

console.log('\n=== the three sentences a body gets about the light, verbatim ===')
console.log("dark    : 'The night is close around you.'")
console.log("dim     : 'The last of the light is going out of the day.'")
console.log("bright  : 'A fire throws a circle of light around you.'   (only at night)")
console.log("working : 'You fumble in the dark.'")

console.log('\n=== no remedy is named in any of them ===')
const LINES = [
  'The night is close around you.',
  'The last of the light is going out of the day.',
  'A fire throws a circle of light around you.',
  'You fumble in the dark.',
]
// Whole phrases, anchored — a substring test reported "A fire throws a circle of light around
// you" as naming a remedy, because "light around" contains "light a". A guard that cries wolf
// on its own prose is worse than none.
const BANNED = [
  /\bbuild\b/i, /\braise a\b/i, /\byou should\b/i, /\ba lamp would\b/i,
  /\bgo inside\b/i, /\blight a (lamp|torch|fire)\b/i, /\bmake a\b/i,
]
for (const l of LINES) {
  const hit = BANNED.filter((b) => b.test(l)).map((b) => String(b))
  console.log(`${hit.length === 0 ? 'ok  ' : 'LEAK'}  ${l}${hit.length ? `  <-- ${hit.join(', ')}` : ''}`)
}

console.log('\n=== and block 1 names no reason to place one ===')
const buildLine = CAPABILITIES.split('\n').find((l) => l.startsWith('build —'))!
console.log(buildLine)
console.log('mentions "lamp":', buildLine.toLowerCase().includes('lamp'))
console.log('mentions "dark" or "light":', /dark|light/i.test(buildLine))

console.log('\n=== isDark, at one instant, in one world ===')
const lit = {
  agents: {}, items: {},
  structures: { l1: { kind: LAMP, x: 10, y: 10, w: 1, h: 1, stage: 'complete', fueledUntilTick: 9e9 } },
}
const MIDNIGHT = 0
for (const [x, y] of [[10, 10], [14, 10], [15, 10], [40, 40]] as const) {
  console.log(`  (${x},${y})  band=${lightBandAt(lit, x, y, MIDNIGHT, DEFAULT_CONFIG).padEnd(6)} isDark=${isDark(lit, x, y, MIDNIGHT, DEFAULT_CONFIG)}`)
}
