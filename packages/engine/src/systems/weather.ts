import { MINUTES_PER_DAY, simTimeFromTick, type Season, type SimConfig } from '@sj/shared'
import type { RngStream } from '../rng.js'
import type { TickCtx } from '../tickCtx.js'

// Controller ruling: the per-season allowed set is code, not config, so the harsh set is a
// constant here and only the day it lifts on is a dial.
const HARSH_KINDS: ReadonlySet<string> = new Set(['storm', 'snow'])

// `dayIndex` is the world's age, not the day of the year: the sky holds its worst back until a
// town has had a week to build somewhere to be during it.
export function allowedKinds(config: SimConfig, season: Season, dayIndex: number): string[] {
  const { harshFromDay, snowOnlyIn, kinds } = config.weather
  return kinds.filter(
    (k) =>
      (k !== 'snow' || season === snowOnlyIn) && (dayIndex >= harshFromDay || !HARSH_KINDS.has(k)),
  )
}

export function rollWeatherKind(
  config: SimConfig,
  rng: RngStream,
  season: Season,
  currentKind: string,
  dayIndex: number,
): string {
  const allowed = allowedKinds(config, season, dayIndex)
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
  const kind = rollWeatherKind(
    ctx.config,
    ctx.rng.get('weather'),
    time.season,
    current.kind,
    Math.floor(ctx.state().tick / MINUTES_PER_DAY),
  )
  const temperatureC = weatherTemperature(ctx.config, kind, time.season, time.isNight)
  if (kind !== current.kind || temperatureC !== current.temperatureC) {
    ctx.emit('weather_changed', { kind, temperatureC, prevKind: current.kind })
  }
}
