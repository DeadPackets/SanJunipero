// Every world knob, read HERE and nowhere else, so no test's world can drift with an env var and
// no entrypoint can answer a knob differently from another by accident. Knobs: see README.md.
import { FOUNDER_IDS, TOWN_RINGS_GENESIS } from '@sj/shared'
import type { DevMapKind } from './devWorld.js'

/** What a PERSON asking for a town gets. The library default stays `scripted`, because the
 *  frozen gates hash that world — see `DEV_MAP_DEFAULT`. */
export const DEV_MAP_HUMAN: DevMapKind = 'showcase'

export type WorldEnv = {
  map: DevMapKind
  rings: number
  interiors: boolean
  builders: boolean
  bridge: boolean
  jointBuild: boolean
  /** How many people the valley is founded with. Whole households only, so the number the town
   *  gets is the largest of 3, 4, 6, 7 and 12 that fits under this. */
  founders: number
  fresh: boolean
}

/** Interiors and the bridge are ON: the shipped town is the world the rehearsal proved. */
const DEFAULTS: Pick<WorldEnv, 'interiors' | 'builders' | 'bridge' | 'jointBuild'> = {
  interiors: true,
  builders: true,
  bridge: true,
  jointBuild: false,
}

/** `Number('') === 0`: a key left with nothing after the `=` is a knob nobody set, and taking
 *  it as zero is the unlit town compose.yaml warns about. */
export const asNumber = (raw: string): number => (raw.trim() === '' ? Number.NaN : Number(raw))

export const intEnv = (name: string, fallback: number, min: number): number => {
  const raw = process.env[name]
  const asked = raw === undefined ? fallback : asNumber(raw)
  if (Number.isInteger(asked) && asked >= min) return asked
  if (raw !== undefined) console.log(`world: ${name}=${raw} ignored; using ${fallback}`)
  return fallback
}

const BOOL_ON: ReadonlySet<string> = new Set(['1', 'true', 'on', 'yes'])
const BOOL_OFF: ReadonlySet<string> = new Set(['0', 'false', 'off', 'no'])

const boolEnv = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  // Every word an operator writes for off, and a line when it is none of them: `!== '0'` read
  // `false` and `off` as ON, and said nothing about it.
  const asked = raw.trim().toLowerCase()
  if (BOOL_ON.has(asked)) return true
  if (BOOL_OFF.has(asked)) return false
  console.log(`world: ${name}=${raw} ignored; using ${fallback ? 'on' : 'off'}`)
  return fallback
}

export function parseWorldEnv(): WorldEnv {
  return {
    map:
      process.env.SJ_MAP === 'orchard'
        ? 'orchard'
        : process.env.SJ_MAP === 'scripted'
          ? 'scripted'
          : DEV_MAP_HUMAN,
    rings: intEnv('SJ_RINGS', TOWN_RINGS_GENESIS, 1),
    interiors: boolEnv('SJ_INTERIORS', DEFAULTS.interiors),
    builders: boolEnv('SJ_BUILDERS', DEFAULTS.builders),
    bridge: boolEnv('SJ_BRIDGE', DEFAULTS.bridge),
    jointBuild: boolEnv('SJ_JOINT', DEFAULTS.jointBuild),
    founders: intEnv('SJ_FOUNDERS', FOUNDER_IDS.length, 1),
    fresh: process.env.SJ_FRESH === '1',
  }
}
