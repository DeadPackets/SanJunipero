import { simTimeFromTick, tickToMoment, weekdayFromTick } from '@sj/shared'

export type Stamp = { day: number; time: string; season: string; weekday: string }

/** ONE read of the town clock. Every date and time a viewer sees is composed from this, so no
 *  two marks on screen can disagree about which minute it is. Capitals because the pixel face
 *  has no lowercase to set the words in. */
export function stamp(tick: number): Stamp {
  const m = tickToMoment(tick)
  return {
    day: m.day,
    time: m.time,
    season: simTimeFromTick(tick).season.toUpperCase(),
    weekday: weekdayFromTick(tick).toUpperCase(),
  }
}

export const momentStamp = (tick: number): string => {
  const s = stamp(tick)
  return `Day ${s.day} ${s.time}`
}
