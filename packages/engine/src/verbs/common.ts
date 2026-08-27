import { type WorldState } from '../state.js'

// What more than one verb module needs: the event shape verbs emit, and the two questions
// every verb asks about reach and about what a pair of hands is holding.
export type PendingEvent = { type: string; payload: unknown }

export function isAdjacentToRect(
  ax: number,
  ay: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  return ax >= rect.x - 1 && ax <= rect.x + rect.w && ay >= rect.y - 1 && ay <= rect.y + rect.h
}

export function heldStacks(state: WorldState, agentId: string, kind: string) {
  return Object.values(state.items)
    .filter((i) => i.kind === kind && i.loc.t === 'agent' && i.loc.id === agentId)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function heldQty(state: WorldState, agentId: string, kind: string): number {
  return heldStacks(state, agentId, kind).reduce((sum, i) => sum + i.qty, 0)
}

export function consumeHeld(
  state: WorldState,
  agentId: string,
  kind: string,
  qty: number,
): PendingEvent[] {
  const events: PendingEvent[] = []
  let left = qty
  for (const i of heldStacks(state, agentId, kind)) {
    if (left <= 0) break
    const take = Math.min(i.qty, left)
    events.push({ type: 'item_qty_changed', payload: { id: i.id, delta: -take } })
    left -= take
  }
  return events
}

export function nearRect(
  state: WorldState,
  agentId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const a = state.agents[agentId]!
  return isAdjacentToRect(a.x, a.y, { x, y, w, h })
}

// The in-progress construction site at exactly (x, y), if any.
export function siteAt(state: WorldState, x: number, y: number) {
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    if (s.x === x && s.y === y && s.stage === 'construction') return s
  }
  return null
}
