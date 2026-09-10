import {
  boundsCentre,
  type CameraBounds,
  fitStop,
  TWO_SHOT_MAX_STOP,
  type ZoomStop,
} from './camera.js'
import { TILE_H, TILE_W } from './iso.js'

// What shot a scene asks the camera for. Pure: the rig applies it, this file decides it.

/** The room, not the faces in it. A box cut to the bodies alone stands them on the picture's
 *  own edge, and the thing they are talking about is never in the frame with them. */
export const SCENE_MARGIN_TILES = 1.5

export type ScenePoint = { sx: number; sy: number }

/** The box a scene asks the camera to hold: every participant, and a tile and a half of ground
 *  on each side. The margin is anisotropic because the ground is — a tile is 32 by 16. */
export function sceneBox(points: readonly ScenePoint[]): CameraBounds | null {
  if (points.length === 0) return null
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.sx)
    maxX = Math.max(maxX, p.sx)
    minY = Math.min(minY, p.sy)
    maxY = Math.max(maxY, p.sy)
  }
  const padX = SCENE_MARGIN_TILES * TILE_W
  const padY = SCENE_MARGIN_TILES * TILE_H
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY }
}

/** Where the camera goes and how close: the centre of that box, at the largest named stop it
 *  fits at. `fitStop` is the town's one fit rule, so a scene and the overview never disagree. */
export type SceneShot = { sx: number; sy: number; stop: ZoomStop }

/** The room is the cast and its margin, never a count of tiles: a twelve-tile floor fits no
 *  phone at any usable stop, and threw a two-hander on a 390 screen out to 0.5. */
export function sceneShot(
  points: readonly ScenePoint[],
  screen: { w: number; h: number },
): SceneShot | null {
  const box = sceneBox(points)
  if (box === null) return null
  const c = boundsCentre(box)
  const stop = fitStop(box, screen)
  return { sx: c.sx, sy: c.sy, stop: stop > TWO_SHOT_MAX_STOP ? TWO_SHOT_MAX_STOP : stop }
}

/** Whose bodies the camera can actually frame: the participants the exterior view draws. A
 *  scene held entirely indoors has nothing on the map to point at. */
export function sceneCast(participants: readonly string[], indoors: ReadonlySet<string>): string[] {
  return participants.filter((id) => !indoors.has(id))
}
