// CONTROLS THE VIEWER CAN MOVE, AND HIDE (U20, U21, plan task 78).
//
// THE ASK: "I need more controls that are out of the way so I can still observe the town",
// and "be able to MOVE/HIDE the controls to get an unobstructed view."
//
// Docking is SLOT-BASED, not free pixel dragging. A freely dragged panel is a panel a viewer
// can lose behind another one, off the edge, or under their own pointer; four edges plus
// hidden covers every case the ask names and none of the ones it does not.
//
// And the escape hatch that makes hiding safe: however much is put away, ONE always-present
// affordance brings it back, and `HUD_TOGGLE_KEY` works from anywhere.

export const DOCK_SLOTS = ['bottom', 'top', 'left', 'right', 'hidden'] as const
export type DockSlot = (typeof DOCK_SLOTS)[number]

/**
 * DEVIATION from the plan's list: `cameraHud` was retired into the control bar by task 77 and
 * `minimap` does not exist. A dockable the renderer cannot place is a setting that does
 * nothing, so the list names the four surfaces that are really on the stage.
 */
export const DOCKABLE = ['controlBar', 'timeline', 'statusStrip', 'fps'] as const
export type Dockable = (typeof DOCKABLE)[number]

export type HudLayout = Readonly<Record<Dockable, DockSlot>>

export const DEFAULT_HUD: HudLayout = {
  controlBar: 'bottom', timeline: 'bottom', statusStrip: 'top', fps: 'right',
}

/**
 * WHICH SLOTS EACH SURFACE CAN REALLY TAKE.
 *
 * Only `controlBar` has all four edges in CSS. The timeline and the status strip are
 * horizontal bands and the frame counter is a corner tag; the renderer honours `hidden` for
 * all three and otherwise leaves them where they live. Offering a move nothing performs is a
 * setting that does nothing, so the menu, the reducer and the stored preference all answer to
 * this one table.
 */
export const SLOTS_FOR: Readonly<Record<Dockable, readonly DockSlot[]>> = {
  controlBar: DOCK_SLOTS,
  timeline: ['bottom', 'hidden'],
  statusStrip: ['top', 'hidden'],
  fps: ['right', 'hidden'],
}

export function canDock(what: Dockable, to: DockSlot): boolean {
  return SLOTS_FOR[what].includes(to)
}

export const HUD_STORAGE_KEY = 'sj.hud.layout'
/** However much is hidden, the dock leaves a grab handle — never nothing. */
export const HUD_PEEK_PX = 12
/** Works from anywhere: the one key that undoes any amount of hiding. */
export const HUD_TOGGLE_KEY = 'h'

const isSlot = (v: unknown): v is DockSlot => (DOCK_SLOTS as readonly unknown[]).includes(v)

/** Persisted per viewer (P4). Unknown keys dropped, bad slots dropped, bad JSON → defaults,
 *  never throws — a corrupt preference must not cost a viewer their controls. */
export function loadHud(storage: Storage): HudLayout {
  let raw: string | null = null
  try {
    raw = storage.getItem(HUD_STORAGE_KEY)
  } catch { return DEFAULT_HUD }
  if (raw === null) return DEFAULT_HUD
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch { return DEFAULT_HUD }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_HUD
  const rec = parsed as Record<string, unknown>
  const out = { ...DEFAULT_HUD } as Record<Dockable, DockSlot>
  for (const key of DOCKABLE) if (isSlot(rec[key]) && canDock(key, rec[key])) out[key] = rec[key]
  return out
}

export function saveHud(storage: Storage, l: HudLayout): void {
  try {
    storage.setItem(HUD_STORAGE_KEY, JSON.stringify(l))
  } catch { /* private mode: the layout is a preference, never a requirement */ }
}

export type HudEv =
  | { kind: 'dock'; what: Dockable; to: DockSlot }
  | { kind: 'hide-all' }
  | { kind: 'show-all' }
  | { kind: 'reset' }

export function hudReducer(prev: HudLayout, ev: HudEv): HudLayout {
  switch (ev.kind) {
    case 'dock': {
      if (prev[ev.what] === ev.to || !canDock(ev.what, ev.to)) return prev
      return { ...prev, [ev.what]: ev.to }
    }
    case 'hide-all': {
      const out = { ...prev } as Record<Dockable, DockSlot>
      for (const k of DOCKABLE) out[k] = 'hidden'
      return out
    }
    case 'show-all': return DEFAULT_HUD
    case 'reset': return DEFAULT_HUD
  }
}

export function hiddenCount(l: HudLayout): number {
  let n = 0
  for (const k of DOCKABLE) if (l[k] === 'hidden') n += 1
  return n
}

export function isFullyHidden(l: HudLayout): boolean {
  return hiddenCount(l) === DOCKABLE.length
}

/**
 * What `HUD_TOGGLE_KEY` does from here.
 *
 * WHAT THE BROWSER CAUGHT: a literal toggle on "is everything hidden" put the REST away when
 * a viewer had hidden only the bar and pressed H to get it back. If anything at all is put
 * away, the key brings everything back; it only puts things away from a full stage. The key
 * is the way back first and a shortcut second.
 */
export function hudToggle(l: HudLayout): HudEv {
  return { kind: hiddenCount(l) > 0 ? 'show-all' : 'hide-all' }
}

/** The town's own word for each surface, so a menu of them reads as places rather than as
 *  identifiers. */
export const DOCKABLE_LABEL: Readonly<Record<Dockable, string>> = {
  controlBar: 'The controls', timeline: 'The timeline',
  statusStrip: 'The day and the sky', fps: 'The frame counter',
}

export const SLOT_LABEL: Readonly<Record<DockSlot, string>> = {
  bottom: 'Along the bottom', top: 'Along the top',
  left: 'Down the left', right: 'Down the right', hidden: 'Put away',
}
