// Every world knob, read HERE and nowhere else, so no test's world can drift with an env var and
// no entrypoint can answer a knob differently from the other one by accident:
//   SJ_MAP=scripted   ask for the frozen G6 fixture BY NAME (the product town otherwise)
//   SJ_RINGS=3        plat the showcase town for three rings of blocks instead of one
//   SJ_INTERIORS=0/1  keep the founders out of doors, or let them go home and sleep
//   SJ_BUILDERS=0/1   stop or start the founders raising houses on claimed plots
//   SJ_BRIDGE=0/1     leave the river uncrossed, or let one founder deck the ford
//   SJ_JOINT=0/1      let a mason lend a hand at a neighbour's walls (off for a measured reason —
//                     see `jointBuild` on `FoundersOpts`)
//   SJ_FRESH=1        throw the town on disk away and start a new day 0
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

/** The four knobs the served town and the dev world still answer differently. Passed at each
 *  entrypoint so the divergence is four literals side by side and not two files of `!==`. */
export type WorldDefaults = Pick<WorldEnv, 'interiors' | 'builders' | 'bridge' | 'jointBuild'>

export const intEnv = (name: string, fallback: number, min: number): number => {
  const asked = Number(process.env[name] ?? fallback)
  if (Number.isInteger(asked) && asked >= min) return asked
  if (process.env[name] !== undefined)
    console.log(`world: ${name}=${process.env[name]} ignored; using ${fallback}`)
  return fallback
}

const boolEnv = (name: string, fallback: boolean): boolean =>
  process.env[name] === undefined ? fallback : process.env[name] !== '0'

export function parseWorldEnv(defaults: WorldDefaults): WorldEnv {
  return {
    map: process.env.SJ_MAP === 'scripted' ? 'scripted' : DEV_MAP_HUMAN,
    rings: intEnv('SJ_RINGS', TOWN_RINGS_GENESIS, 1),
    interiors: boolEnv('SJ_INTERIORS', defaults.interiors),
    builders: boolEnv('SJ_BUILDERS', defaults.builders),
    bridge: boolEnv('SJ_BRIDGE', defaults.bridge),
    jointBuild: boolEnv('SJ_JOINT', defaults.jointBuild),
    fresh: process.env.SJ_FRESH === '1',
  }
}
