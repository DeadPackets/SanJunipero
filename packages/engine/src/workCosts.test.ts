import { describe, expect, it } from 'vitest'
import { ADULT_AGE_DAYS, SimConfigSchema } from '@sj/shared'
import { fold } from './fold.js'
import { effectiveConfig } from './laws.js'
import { composePerception } from './perception.js'
import { genesisState } from './state.js'
import { ev, grid } from './testutil/world.js'
import { buildTicks, makeables } from './verbs/craft.js'

const CONFIG = SimConfigSchema.parse({ construction: { houseTicks: 240 } })

describe('effective work cost', () => {
  it('uses 240 minutes for a house and 6480 for a cottage with the same wood cost', () => {
    const rows = makeables(CONFIG).builds
    expect(rows.find((r) => r.kind === 'house')).toMatchObject({
      inputs: { wood: 22.5 },
      durationTicks: 240,
    })
    expect(rows.find((r) => r.kind === 'cottage')).toMatchObject({
      inputs: { wood: 22.5 },
      durationTicks: 6480,
    })
    expect(buildTicks(CONFIG, 'house')).toBe(240)
    expect(buildTicks(CONFIG, 'cottage')).toBe(6480)
  })

  it('uses a live recipe law for both costs and visible resumable progress', () => {
    let state = genesisState(CONFIG, grid(12))
    state = fold(
      state,
      ev('agent_spawned', {
        id: 'a1',
        name: 'a1',
        x: 3,
        y: 4,
        ageDays: ADULT_AGE_DAYS,
      }),
    )
    state = fold(
      state,
      ev('config_changed', {
        path: 'structures.recipes.alehouse',
        value: { ...CONFIG.structures.recipes.cottage!, durationTicks: 7200 },
      }),
      CONFIG,
    )
    state = fold(
      state,
      ev('structure_planned', {
        id: 'site',
        kind: 'alehouse',
        x: 3,
        y: 2,
        w: 3,
        h: 3,
        maxHp: 50,
        flammable: true,
        builderId: 'a1',
      }),
    )
    state = fold(state, ev('structure_progressed', { id: 'site', ticks: 960 }))
    const live = effectiveConfig(CONFIG, state.laws)
    expect(makeables(live).builds.find((r) => r.kind === 'alehouse')?.durationTicks).toBe(7200)
    expect(
      composePerception(state, CONFIG, 'a1', []).visible.structures.find((s) => s.id === 'site')
        ?.raised,
    ).toEqual({ done: 960, needs: 7200 })
  })
})
