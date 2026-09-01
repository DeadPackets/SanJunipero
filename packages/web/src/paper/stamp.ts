import { simTimeFromTick, tickToMoment } from '@sj/shared'

export const momentStamp = (tick: number): string => {
  const m = tickToMoment(tick)
  return `Day ${m.day} ${m.time}`
}

/** The two ends of the broadsheet's dateline: what day it is on the left, what hour on the
 *  right. Capitals because the pixel face has no lowercase to set them in. */
export function dateline(tick: number): { day: string; time: string } {
  const m = tickToMoment(tick)
  return {
    day: `DAY ${m.day} · ${simTimeFromTick(tick).season.toUpperCase()}`,
    time: m.time,
  }
}
