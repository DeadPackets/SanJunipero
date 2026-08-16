import { useSyncExternalStore } from 'react'
import { tickToMoment } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { describeEvent } from './chronicleFormat.js'
import { EMPTY_COPY } from './townStats.js'

export const FEED_MAX = 120

const GLYPH: Record<string, string> = {
  agent_died: 'death',
  structure_completed: 'done',
  fire_ignited: 'fire',
  weather_changed: 'weather',
}

export function ChroniclePanel({ store }: { store: WorldStore }) {
  const events = useSyncExternalStore(store.subscribe, store.recentEvents)
  const state = useSyncExternalStore(store.subscribe, store.getState)

  const lines: Array<{ key: number; tick: number; kind: string; text: string }> = []
  for (let i = events.length - 1; i >= 0 && lines.length < FEED_MAX; i--) {
    const ev = events[i]!
    const text = describeEvent(ev, state)
    if (text !== null) lines.push({ key: i, tick: ev.tick, kind: GLYPH[ev.type] ?? 'plain', text })
  }

  return (
    <div className="chronicle-panel">
      <h2 className="px-title">Chronicle</h2>
      {lines.length === 0 ? (
        <p className="feed-empty">{EMPTY_COPY.chronicle}</p>
      ) : (
        <ol className="feed" aria-live="polite">
          {lines.map((l) => {
            const m = tickToMoment(l.tick)
            return (
              <li key={l.key} className={`feed-line ${l.kind}`}>
                <span className="stamp">Day {m.day} {m.time}</span>
                <span className="feed-text">{l.text}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
