import type { AgentBody } from '@sj/engine/state'
import type { SimEvent } from '@sj/shared'
import type { Facing } from './iso.js'

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

export function interpolatePos(
  prev: { x: number; y: number; atMs: number },
  next: { x: number; y: number; atMs: number },
  nowMs: number,
): { x: number; y: number } {
  const span = next.atMs - prev.atMs
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - prev.atMs) / span))
  return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t }
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
