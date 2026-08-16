import type { AgentBody } from '@sj/engine/state'
import type { SimEvent } from '@sj/shared'
import { facingFrom, type Facing } from './iso.js'

// Character standard v2 sheet layout (forge style bible) — the atlas is the runtime truth
export const SHEET_COLS: Facing[] = ['sw', 'se', 'ne', 'nw']
export const SHEET_ROWS = ['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b', 'sleep'] as const
export const CELL = 96
export const FEET_Y = 88
export const WALK_FPS = 8
export const WALK_LOOP = ['contact-a', 'passing-a', 'contact-b', 'passing-b'] as const // v2, 8fps
export const BOB_PX = 1 // passing frames render 1px lower — render-time only, never baked
export const CHAR_TARGET_PX = 52 // ≈1.6 tiles of 32px; art height 64 in cell → scale 52/64
export const WALK_FRAME_MS_V4 = 180 // v4 ruling: F1-F2-F1-F3 cadence at 180ms/frame

// Click target: wider than the ~52px sprite and taller than its ~64px art, so a
// character is easy to hit. Local sprite coords, feet at (0,0), body rising upward.
export const HIT_AREA_W = 52
export const HIT_AREA_H = 72
// hitArea lives in LOCAL sprite space and Pixi scales it with the sprite, so the
// local rect must be inflated by 1/scale to keep the click target 52×72 SCREEN px.
export function hitRect(scale: number): { x: number; y: number; w: number; h: number } {
  return { x: -HIT_AREA_W / 2 / scale, y: -HIT_AREA_H / scale, w: HIT_AREA_W / scale, h: HIT_AREA_H / scale }
}
export const NAME_TAG_ABOVE_HEAD_PX = 8
export const NAME_TAG_MAX_CHARS = 16
// Hover name tag: the agent's name, truncated to fit the pixel slab.
export function nameTagText(name: string): string {
  return name.length <= NAME_TAG_MAX_CHARS ? name : `${name.slice(0, NAME_TAG_MAX_CHARS - 1)}…`
}

export type CharPose = { row: (typeof SHEET_ROWS)[number]; facing: Facing; bobY: number }

export function charPose(
  a: { asleep: boolean; collapsed: boolean; walking: boolean; facing: Facing; nowMs: number },
  frameMs = 1000 / WALK_FPS,
): CharPose {
  if (a.asleep || a.collapsed) return { row: 'sleep', facing: a.facing, bobY: 0 }
  if (a.walking) {
    const row = WALK_LOOP[Math.floor(a.nowMs / frameMs) % WALK_LOOP.length]!
    return { row, facing: a.facing, bobY: row === 'passing-a' || row === 'passing-b' ? BOB_PX : 0 }
  }
  return { row: 'idle', facing: a.facing, bobY: 0 }
}

export type Waypoint = { x: number; y: number; atMs: number }

// Interpolate along a scheduled path polyline (path[0] is the anchor). The body
// steps through each waypoint tile — never a straight line from start to final
// destination — so a corner leg can't sweep across a building's drawn volume.
export function interpolatePos(path: ReadonlyArray<Waypoint>, nowMs: number): { x: number; y: number } {
  if (path.length === 0) return { x: 0, y: 0 }
  const first = path[0]!
  if (nowMs <= first.atMs) return { x: first.x, y: first.y }
  const last = path[path.length - 1]!
  if (nowMs >= last.atMs) return { x: last.x, y: last.y }
  for (let i = 1; i < path.length; i++) {
    const next = path[i]!
    if (nowMs <= next.atMs) {
      const prev = path[i - 1]!
      const span = next.atMs - prev.atMs
      const t = span <= 0 ? 1 : (nowMs - prev.atMs) / span
      return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t }
    }
  }
  return { x: last.x, y: last.y }
}

// Drop waypoints we've passed, keeping the last-passed one as the anchor so the
// path queue stays short while the interpolation never re-winds.
export function prunePath(path: ReadonlyArray<Waypoint>, nowMs: number): Waypoint[] {
  let cut = 0
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i + 1]!.atMs <= nowMs) cut = i + 1
    else break
  }
  return cut > 0 ? path.slice(cut) : [...path]
}

// Facing for the leg being walked NOW — path[0] (anchor) → path[1] — so a queued
// multi-waypoint path never turns the body toward its final leg early.
export function legFacing(path: ReadonlyArray<Waypoint>): Facing | null {
  if (path.length < 2) return null
  return facingFrom(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y)
}

export const EMOTE_KINDS = ['exclaim', 'question', 'heart', 'star', 'sleep', 'hunger',
  'cold', 'rain', 'hurt', 'talk', 'idea', 'anger'] as const // mirrors /assets/emotes.json order
export type EmoteKind = (typeof EMOTE_KINDS)[number]

export const NEED_EMOTE_BELOW = 30

export function emoteFor(a: AgentBody, recent: SimEvent[]): EmoteKind | null {
  if (!a.alive) return null // the renderer's tone handling owns death (Task 15)
  const mine = (type: string): boolean =>
    recent.some((ev) => ev.type === type && (ev.payload as { agentId?: string }).agentId === a.id)
  if (mine('agent_injured')) return 'hurt'
  if (a.collapsedSinceTick !== null) return 'exclaim'
  if (a.asleep) return 'sleep'
  if (a.needs.hunger < NEED_EMOTE_BELOW) return 'hunger'
  if (a.needs.warmth < NEED_EMOTE_BELOW) return 'cold'
  if (mine('agent_spoke')) return 'talk'
  if (recent.some((ev) => ev.type === 'weather_changed' && ['rain', 'storm'].includes((ev.payload as { kind: string }).kind))) return 'rain'
  return null
}
