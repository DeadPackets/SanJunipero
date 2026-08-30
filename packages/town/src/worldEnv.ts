// Every world knob, read HERE and nowhere else, so no test's world can drift with an env var and
// no entrypoint can answer a knob differently from another by accident. Knobs: see README.md.
import { TOWN_RINGS_GENESIS } from '@sj/shared'
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
  fresh: boolean
}

/** Interiors and the bridge are ON: the shipped town is the world the rehearsal proved. */
const DEFAULTS: Pick<WorldEnv, 'interiors' | 'builders' | 'bridge' | 'jointBuild'> = {
  interiors: true,
  builders: true,
  bridge: true,
  jointBuild: false,
}

export const intEnv = (name: string, fallback: number, min: number): number => {
  const asked = Number(process.env[name] ?? fallback)
  if (Number.isInteger(asked) && asked >= min) return asked
  if (process.env[name] !== undefined)
    console.log(`world: ${name}=${process.env[name]} ignored; using ${fallback}`)
  return fallback
}

const boolEnv = (name: string, fallback: boolean): boolean =>
  process.env[name] === undefined ? fallback : process.env[name] !== '0'

export function parseWorldEnv(): WorldEnv {
  return {
    map: process.env.SJ_MAP === 'scripted' ? 'scripted' : DEV_MAP_HUMAN,
    rings: intEnv('SJ_RINGS', TOWN_RINGS_GENESIS, 1),
    interiors: boolEnv('SJ_INTERIORS', DEFAULTS.interiors),
    builders: boolEnv('SJ_BUILDERS', DEFAULTS.builders),
    bridge: boolEnv('SJ_BRIDGE', DEFAULTS.bridge),
    jointBuild: boolEnv('SJ_JOINT', DEFAULTS.jointBuild),
    fresh: process.env.SJ_FRESH === '1',
  }
}
