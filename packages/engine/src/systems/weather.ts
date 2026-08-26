import { simTimeFromTick, type Season, type SimConfig } from '@sj/shared'
import type { RngStream } from '../rng.js'
import type { TickCtx } from '../worldTick.js'

// Controller ruling: the per-season allowed set is code, not config.
export function allowedKinds(config: SimConfig, season: Season): string[] {
  return config.weather.kinds.filter((k) => k !== 'snow' || season === config.weather.snowOnlyIn)
}

export function rollWeatherKind(
  config: SimConfig,
  rng: RngStream,
  season: Season,
  currentKind: string,
): string {
  const allowed = allowedKinds(config, season)
  const change = rng.next() < config.weather.hourlyChangeChance
  if (!change && allowed.includes(currentKind)) return currentKind
  return allowed[rng.int(allowed.length)]!
}

export function weatherTemperature(
  config: SimConfig,
  kind: string,
  season: Season,
  isNight: boolean,
): number {
  const wet = kind === 'rain' || kind === 'storm' || kind === 'snow'
  return (
    config.weather.seasonTemps[season] +
    (isNight ? config.weather.nightTempDelta : 0) +
    (wet ? config.weather.rainTempDelta : 0)
  )
}

export function weatherSystem(ctx: TickCtx): void {
  const time = simTimeFromTick(ctx.state().tick)
  if (time.minute !== 0) return
  const current = ctx.state().weather
  const kind = rollWeatherKind(ctx.config, ctx.rng.get('weather'), time.season, current.kind)
  const temperatureC = weatherTemperature(ctx.config, kind, time.season, time.isNight)
  if (kind !== current.kind || temperatureC !== current.temperatureC) {
    ctx.emit('weather_changed', { kind, temperatureC, prevKind: current.kind })
  }
}
