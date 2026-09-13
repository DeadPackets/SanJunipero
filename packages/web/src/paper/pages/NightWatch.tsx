import { useState, useSyncExternalStore } from 'react'
import { agentName, nightStartTick } from '@sj/shared'
import type { WorldStore } from '../../state/worldStore.js'
import type { Subject } from '../../stage/index.js'
import { PersonLink } from '../../ui/PersonLink.js'
import { usePolled } from '../../ui/useEndpoint.js'

type JournalRow = { tick: number; day: number; text: string; kind: 'journal' | 'dream' }

/** The beat the paper's other slow reads keep. A journal is written once a night, so anything
 *  faster is a fetch per sleeper for nothing. */
const NIGHT_POLL_MS = 30_000

const journalRows = (body: unknown): JournalRow[] | null =>
  Array.isArray(body) ? (body as JournalRow[]) : null

const lastOf = (rows: readonly JournalRow[], kind: JournalRow['kind']): JournalRow | null => {
  let out: JournalRow | null = null
  for (const r of rows) if (r.kind === kind && (out === null || r.tick >= out.tick)) out = r
  return out
}

type Bodies = Readonly<Record<string, { alive: boolean; asleep: boolean } | undefined>>

/** Every body abed, by id, so a card keeps its place in the drift while the town breathes. */
function sleepers(agents: Bodies | undefined): string[] {
  if (agents === undefined) return []
  return Object.entries(agents)
    .filter(([, a]) => a !== undefined && a.alive && a.asleep)
    .map(([id]) => id)
    .sort()
}

/** One sleeping mind's night, as it wrote it. Nothing written yet is no card at all, which is
 *  what keeps the watch itself empty rather than a shelf of blanks. */
function NightCard({
  agentId,
  name,
  since,
  onSubject,
}: {
  agentId: string
  name: string
  since: number
  onSubject: (subject: Subject) => void
}) {
  // A journal and a dream are written once a night, so a card holding both has nothing left to
  // ask for: the url goes null, the reader loses its last subscriber and the interval is cleared.
  const [held, setHeld] = useState<{ wrote: JournalRow; dreamt: JournalRow } | null>(null)
  const read = usePolled<JournalRow[]>(
    held === null ? `/api/agent/${encodeURIComponent(agentId)}/journal` : null,
    journalRows,
    NIGHT_POLL_MS,
  )
  const tonight = (read.data ?? []).filter((r) => r.tick >= since)
  const found = { wrote: lastOf(tonight, 'journal'), dreamt: lastOf(tonight, 'dream') }
  if (held === null && found.wrote !== null && found.dreamt !== null)
    setHeld({ wrote: found.wrote, dreamt: found.dreamt })
  const { wrote, dreamt } = held ?? found
  if (wrote === null && dreamt === null) return null
  return (
    <li className="night-card">
      <h4 className="night-who">
        <PersonLink id={agentId} name={name} onSubject={onSubject} />
      </h4>
      {wrote !== null && <p className="night-said">{wrote.text}</p>}
      {dreamt !== null && <p className="night-dreamt">{dreamt.text}</p>}
    </li>
  )
}

/** The town's own night. Sixteen real minutes of every sim-day nobody is doing anything, and it
 *  is the window every mind writes its journal and dreams in. */
export function NightWatch({
  store,
  onSubject,
}: {
  store: WorldStore
  onSubject: (subject: Subject) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const abed = sleepers(state?.agents)
  const since = nightStartTick(tick)
  return (
    <ol className="night-cards" aria-label="What the town wrote tonight">
      {abed.map((id) => (
        <NightCard
          key={`${id}@${since}`}
          agentId={id}
          name={agentName(state?.agents, id)}
          since={since}
          onSubject={onSubject}
        />
      ))}
    </ol>
  )
}
