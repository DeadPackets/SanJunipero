import { describe, it, expect } from 'vitest'
import { SEASONS, SimConfigSchema, simTimeFromTick, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { RngStream, RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { allowedKinds, rollWeatherKind, weatherTemperature } from './weather.js'

const CFG: SimConfig = SimConfigSchema.parse({})

let seq = 8000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })

function tickTo(s: WorldState, tick: number, rng: RngStreams): WorldTickResult {
  const wt = createWorldTick(CFG, rng)
  return wt(fold(s, ev('tick_advanced', {}, tick), CFG))
}

describe('allowedKinds', () => {
  it('snow is winter-only; storm and the rest are legal in all seasons', () => {
    for (const season of SEASONS) {
      const allowed = allowedKinds(CFG, season)
      expect(allowed.includes('snow')).toBe(season === 'winter')
      expect(allowed).toContain('storm')
      expect(allowed).toContain('sunny')
      expect(allowed).toContain('cloudy')
      expect(allowed).toContain('rain')
    }
  })
})

describe('rollWeatherKind: a seeded year of hourly rolls', () => {
  it('only ever yields legal kinds for the season, and snow does occur in winter', () => {
    const rng = RngStream.seed('wy0', 'weather')
    let kind = 'sunny'
    let snowHours = 0
    for (let h = 0; h < 364 * 24; h++) {
      const { season } = simTimeFromTick(h * 60)
      kind = rollWeatherKind(CFG, rng, season, kind)
      expect(CFG.weather.kinds).toContain(kind)
      if (kind === 'snow') {
        expect(season).toBe('winter')
        snowHours++
      }
    }
    expect(snowHours).toBeGreaterThan(0)
  })
})

describe('weatherTemperature', () => {
  it('is seasonTemp + nightDelta(if night) + rainDelta(if rain/storm/snow), exactly', () => {
    expect(weatherTemperature(CFG, 'sunny', 'spring', false)).toBe(14)
    expect(weatherTemperature(CFG, 'sunny', 'spring', true)).toBe(8)
    expect(weatherTemperature(CFG, 'cloudy', 'autumn', false)).toBe(10)
    expect(weatherTemperature(CFG, 'rain', 'spring', false)).toBe(10)
    expect(weatherTemperature(CFG, 'storm', 'summer', false)).toBe(22)
    expect(weatherTemperature(CFG, 'snow', 'winter', true)).toBe(-14)
  })
})

describe('fold: weather_changed', () => {
  it('replaces the world weather', () => {
    let s = genesisState(CFG)
    s = fold(s, ev('weather_changed', { kind: 'storm', temperatureC: 22 }), CFG)
    expect(s.weather).toEqual({ kind: 'storm', temperatureC: 22 })
  })
})

describe('worldTick: weather', () => {
  const NOON = 720 // hour 12, minute 0, spring day
  const NIGHTFALL = 1200 // hour 20, minute 0, night

  it('does not roll off the hour', () => {
    // seed w11 would change the kind if a roll happened
    const r = tickTo(genesisState(CFG), 1, new RngStreams('w11'))
    expect(r.events.map((e) => e.type)).not.toContain('weather_changed')
  })

  it('emits nothing when neither kind nor temperature changes', () => {
    // seed w0: change roll ≈ 0.7498 fails; sunny spring day stays 14°C like genesis
    const s = { ...genesisState(CFG), tick: NOON - 1 }
    const r = tickTo(s, NOON, new RngStreams('w0'))
    expect(r.events.map((e) => e.type)).not.toContain('weather_changed')
    expect(r.state.weather).toEqual({ kind: 'sunny', temperatureC: 14 })
  })

  it('emits on a temperature-only change at nightfall', () => {
    const s = { ...genesisState(CFG), tick: NIGHTFALL - 1 }
    const r = tickTo(s, NIGHTFALL, new RngStreams('w0'))
    expect(r.events).toContainEqual({ type: 'weather_changed', payload: { kind: 'sunny', temperatureC: 8 } })
    expect(r.state.weather).toEqual({ kind: 'sunny', temperatureC: 8 })
  })

  it('emits on a kind change: seed w11 rolls rain at spring noon', () => {
    // change roll ≈ 0.1068 passes, pick int(4) = 2 → rain; 14 − 4 = 10°C
    const s = { ...genesisState(CFG), tick: NOON - 1 }
    const r = tickTo(s, NOON, new RngStreams('w11'))
    expect(r.events).toContainEqual({ type: 'weather_changed', payload: { kind: 'rain', temperatureC: 10 } })
    expect(r.state.weather).toEqual({ kind: 'rain', temperatureC: 10 })
  })
})
