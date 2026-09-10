import { sceneCast } from '../render/sceneFraming.js'
import type { StakeScore } from '@sj/shared'

export const CUT_MIN_MS = 8000 // never cut faster — letterboxed TV pacing

/** One turn of the quiet round, matching the gateway's own scoring window so a cut and a turn
 *  are the same length of town time. `CUT_MIN_MS` still gates how fast either can land. */
export const QUIET_TURN_TICKS = 60

/** The gateway answers null when nothing has scored — right for a lens a person is steering, an
 *  empty frame for an unattended stream. The round turns one window at a time, so the caption
 *  always has a name in it. */
export function quietSubject(people: readonly string[], nowTick: number): string | null {
  if (people.length === 0) return null
  const tick = Number.isFinite(nowTick) ? Math.max(0, nowTick) : 0
  return people[Math.floor(tick / QUIET_TURN_TICKS) % people.length]!
}

/** Every living body asleep — the town's own night, not the clock's, so a mind still up at
 *  02:00 keeps the camera. Written without an allocation: it runs on the store's notify, which
 *  is once an animation frame while the town moves. */
export function townAsleep(
  agents: Readonly<Record<string, { alive: boolean; asleep: boolean }>> | undefined,
): boolean {
  if (agents === undefined) return false
  let living = 0
  for (const id in agents) {
    if (!Object.hasOwn(agents, id)) continue
    const a = agents[id]
    if (a?.alive !== true) continue
    living++
    if (!a.asleep) return false
  }
  return living > 0
}

/** ★ A MIND INDOORS IS AN EMPTY STREET. The exterior view does not draw interiors, so cutting to
 *  somebody inside a house holds the camera on three closed doors while they speak. Nobody
 *  outside is a reason to HOLD the shot, never to cut to nobody. */
const NOBODY_INSIDE: ReadonlySet<string> = new Set()

/** Who the camera answers to, closest claim first. A viewer who asked to follow somebody always
 *  wins: automation never overrules a hand on the lens. Below that a replayed moment is ABOUT
 *  its cast, a sleeping town is a picture of a sleeping town, and then the gateway's own cut. */
export type CameraClaim =
  | { by: 'pinned'; agentId: string }
  | { by: 'moment'; cast: readonly string[] }
  /** the gateway's cut: the people the shot is scored FOR, framed together */
  | { by: 'cut'; cast: readonly string[] }
  /** a cut whose whole cast is in ONE room: the interior renderer draws that shot */
  | { by: 'interior'; structureId: string; cast: readonly string[] }
  /** nothing scored: one face at a time, so an unattended stream is never empty */
  | { by: 'round'; agentId: string }
  /** a claim the map cannot show: the director stands down, and the shot HOLDS */
  | { by: 'hold' }
  | { by: 'town' }

/** The one room a whole cast shares, or null: a camera cannot be in two rooms at once, and a
 *  body whose room nobody recorded is not in a shot. */
function sharedRoom(cast: readonly string[], roomOf: (id: string) => string | null): string | null {
  let room: string | null = null
  for (const id of cast) {
    const r = roomOf(id)
    if (r === null || (room !== null && r !== room)) return null
    room = r
  }
  return room
}

const NO_ROOM = (): null => null

export function cameraClaim(
  pinned: string | null,
  moment: readonly string[],
  indoors: ReadonlySet<string> = NOBODY_INSIDE,
  director: { readonly cut: StakeScore | null; readonly quiet?: boolean } | null = null,
  asleep = false,
  roundSubject: string | null = null,
  roomOf: (id: string) => string | null = NO_ROOM,
): CameraClaim {
  if (pinned !== null) return { by: 'pinned', agentId: pinned }
  // A moment whose cast is all indoors HOLDS rather than handing the camera to a gateway that
  // is scoring the live tick, not this one.
  if (moment.length > 0) {
    const played = sceneCast(moment, indoors)
    return played.length === 0 ? { by: 'hold' } : { by: 'moment', cast: played }
  }
  // The bar says the town is asleep, and cutting to a body under that would call it a liar.
  if (asleep) return { by: 'town' }
  const cut = director?.cut ?? null
  if (cut !== null) {
    const cast = sceneCast(cut.agentIds, indoors)
    if (cast.length > 0) return { by: 'cut', cast }
    const room = sharedRoom(cut.agentIds, roomOf)
    return room === null
      ? { by: 'hold' }
      : { by: 'interior', structureId: room, cast: cut.agentIds }
  }
  // The beat after a peak is a HELD shot: the round may not turn under it, and a cast that has
  // walked indoors mid-beat is not a reason to go looking for somebody else either.
  if (director?.quiet === true) return { by: 'hold' }
  return roundSubject === null ? { by: 'town' } : { by: 'round', agentId: roundSubject }
}
