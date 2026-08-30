import { tickToMoment } from '@sj/shared'

export const momentStamp = (tick: number): string => {
  const m = tickToMoment(tick)
  return `Day ${m.day} ${m.time}`
}
