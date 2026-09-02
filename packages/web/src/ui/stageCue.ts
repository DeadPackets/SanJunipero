import { useEffect, useState } from 'react'
import { agentName, chronicleIcon, type SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { chronicleLabel } from './importantFeed.js'

// ★ WHAT JUST HAPPENED, ON THE STAGE. The desk had one line of story chrome and it printed
// "DIRECTOR · name". Everything the town DECIDED — a discovery, a law, a night shared — went
// straight to the paper, which is closed by default, so a viewer watching the town could not
// tell that anything had been decided at all.

/** How long a moment stands before the slot goes back to naming the shot. */
export const CUE_HOLD_MS = 6000
/** The glyph is 8×8 drawn at two screen pixels a drawn one, like every pixel mark in the sheet. */
export const CUE_ICON_PX = 16

/** The law family the town has no formatter for: `chronicleLine` predates it and the arbiter
 *  writes the words, so the slot says who and what and leaves the wording to the law itself. */
const LAW_LINES: Readonly<Record<string, (p: Record<string, unknown>, who: string) => string>> = {
  law_proposed: (p, who) => `${who} proposes a law${said(p)}`,
  law_ratified: (p) => `The town made it law${said(p)}`,
  law_broken: (_p, who) => `${who} broke the town's own law.`,
  law_repealed: (p) => `The town let a law go${said(p)}`,
}
const said = (p: Record<string, unknown>): string =>
  typeof p.text === 'string' && p.text.trim() !== '' ? ` — ${p.text.trim()}` : '.'

const LAW_ICON: Readonly<Record<string, string>> = {
  law_proposed: 'quill',
  law_ratified: 'quill',
  law_broken: 'flame',
  law_repealed: 'quill',
}

/** Everything the stage says out loud. A custom is missing on purpose: the arbiter keeps customs
 *  as rows and emits no event for one, so nothing reaches this slot to print (see the report). */
export const CUE_TYPES: readonly string[] = [
  'discovery_made',
  'co_slept',
  ...Object.keys(LAW_LINES),
]

export type StageCue = { text: string; icon: string; bodies: readonly string[] }

/** Whose bodies this moment belongs to — the ones that bounce under it. */
export function bodiesOf(ev: SimEvent): string[] {
  const p = ev.payload as { agentId?: string; byId?: string; aId?: string; bId?: string }
  return [p.agentId, p.byId, p.aId, p.bId].filter((v): v is string => typeof v === 'string')
}

export function cueFor(ev: SimEvent, state: Parameters<typeof chronicleLabel>[1]): StageCue | null {
  if (!CUE_TYPES.includes(ev.type)) return null
  const bodies = bodiesOf(ev)
  const law = LAW_LINES[ev.type]
  if (law !== undefined) {
    const p = ev.payload as Record<string, unknown>
    const who = agentName(state?.agents, bodies[0] ?? '')
    return { text: law(p, who), icon: LAW_ICON[ev.type] ?? 'quill', bodies }
  }
  const text = chronicleLabel(ev, state)
  return text === null ? null : { text, icon: chronicleIcon(ev.type), bodies }
}

/** The slot's own moment: it lands on the frame the event arrives on and clears `CUE_HOLD_MS`
 *  later. One at a time — a second moment replaces the first rather than queueing behind it,
 *  because the slot is one line and a stale one is worse than a missed one. */
export function useStageCue(store: WorldStore): StageCue | null {
  const [cue, setCue] = useState<StageCue | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = store.onEvents((evts) => {
      const state = store.getState()
      for (const ev of evts) {
        const next = cueFor(ev, state)
        if (next === null) continue
        setCue(next)
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          setCue(null)
        }, CUE_HOLD_MS)
      }
    })
    return () => {
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [store])
  return cue
}
