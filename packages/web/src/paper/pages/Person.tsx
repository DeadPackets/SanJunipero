import { useEffect, useState, useSyncExternalStore } from 'react'
import { bondLevel, bondWarmth, tickToMoment } from '@sj/shared'
import { resolveAssetId } from '../../render/textures.js'
import { bustStyle } from '../../ui/bustStyle.js'
import { biographyOf, EMPTY_DISPATCHES } from '../../ui/dispatches.js'
import { bondsFeed, dispatchesFeed, lineageFeed } from '../../ui/feeds.js'
import { useFeed } from '../../ui/useEndpoint.js'
import { CONDITION_WORD, conditionsOf, stateWord, type AgentView } from '../../ui/status.js'
import {
  CHANGE_EMPTY,
  SKILLS_EMPTY,
  THOUGHT_EMPTY,
  changeLog,
  hasChanged,
  type ChangeEntry,
} from '../../ui/becoming.js'
import { EMPTY_LINEAGE, bondArc, bondTypeOf, relationLine } from '../../ui/bondModel2.js'
import type { PageProps } from './index.js'

const DOC_CACHE_MS = 30_000
const NEED_LOW = 30
const NOTHING_WRITTEN = 'Nothing written yet.'
/** Describes rather than promises: on a scripted stream nobody is writing at all. */
const BIOGRAPHY_EMPTY = 'Nobody has written of them yet.'

type Doc = 'ledgers' | 'journal' | 'personality'
export type LedgerRow = { personId: string; doc: string; updatedDay: number }
export type JournalRow = { tick: number; day: number; text: string; kind: 'journal' | 'dream' }
type PersonalityRow = { version: number; day: number; doc: string; edit: string }

const cache = new Map<string, { at: number; rows: unknown[] }>()
/** A read that failed is NOT an empty record: caching it turns one 500 into 30 seconds of
 *  "Nothing written yet." about a person. Only an answer is cached. */
export async function fetchDoc<T>(
  agentId: string,
  doc: Doc,
  fetchFn: typeof fetch = fetch,
): Promise<T[]> {
  const key = `${agentId}:${doc}`
  const hit = cache.get(key)
  if (hit !== undefined && performance.now() - hit.at < DOC_CACHE_MS) return hit.rows as T[]
  const res = await fetchFn(`/api/agent/${encodeURIComponent(agentId)}/${doc}`)
  if (!res.ok) return []
  const rows = (await res.json()) as T[]
  cache.set(key, { at: performance.now(), rows })
  return rows
}

/** A dream is the mind's, but it is not something the mind wrote down — say which is which. */
export const journalStamp = (row: JournalRow): string =>
  row.kind === 'dream' ? `Day ${row.day}, a dream` : `Day ${row.day}`

function ageBand(ageDays: number): string {
  const years = Math.floor(ageDays / 364)
  if (years < 18) return 'young'
  if (years < 60) return 'grown'
  return 'elder'
}

const level = (xp: number): number => Math.floor(Math.sqrt(xp / 100))

function NeedBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="need-row">
      <span className="need-label">{label}</span>
      <div className="need-track">
        <div className={v < NEED_LOW ? 'need-fill low' : 'need-fill'} style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  )
}

/** What a run has made of this person: what they thought, what was written of them, what has
 *  changed. Every section is sourced to something the run recorded, and where the record is
 *  empty it says the RECORD is empty. */
export function PersonStoryView({
  thought,
  journal,
  changes,
  biography = null,
}: {
  thought: { text: string } | null
  /** `null` while the read is still out — which is not the same thing as an empty journal */
  journal: readonly JournalRow[] | null
  changes: readonly ChangeEntry[] | null
  /** The chronicler's write-up, from the PUBLIC record alone. Null until one is written. */
  biography?: { day: number; title: string; body: string } | null
}) {
  return (
    <>
      <section className="sheet-block">
        <h3 className="sheet-h">Thought</h3>
        <p className="thought-line" aria-live="polite">
          {thought !== null ? `“${thought.text}”` : THOUGHT_EMPTY}
        </p>
      </section>

      <section className="sheet-block">
        <h3 className="sheet-h">Journal</h3>
        {journal === null ? (
          <Skeleton />
        ) : journal.length === 0 ? (
          <p className="sheet-empty">{NOTHING_WRITTEN}</p>
        ) : (
          journal.map((row, i) => (
            <p key={i} className="doc">
              <span className="stamp">{journalStamp(row)}</span> {row.text}
            </p>
          ))
        )}
      </section>

      {/* What is known of them from the outside: the chronicler reads the public log and
          nothing else, so this section can never say what the person privately thought. */}
      <section className="sheet-block">
        <h3 className="sheet-h">What is written of them</h3>
        {biography === null ? (
          <p className="doc">{BIOGRAPHY_EMPTY}</p>
        ) : (
          <article className="biography">
            <p className="biography-head">
              <span className="stamp">Day {biography.day}</span> {biography.title}
            </p>
            <p className="biography-body">{biography.body}</p>
          </article>
        )}
      </section>

      {/* Leads with the LATEST document and the most recent edit; a person with one version
          has moved nothing yet and is told so, rather than handed v1 as a character sheet. */}
      <section className="sheet-block">
        <h3 className="sheet-h">How they have changed</h3>
        {changes === null ? (
          <Skeleton />
        ) : !hasChanged(changes) ? (
          <p className="doc">{CHANGE_EMPTY}</p>
        ) : (
          changes.map((e) => (
            <article key={e.version} className="change-entry">
              <p className="change-head">
                <span className="stamp">Day {e.day}</span> {e.edit}
              </p>
              {e.diff.length > 0 && (
                <pre className="diff">
                  {e.diff.map((l, i) => (
                    <div key={i} className={`diff-line ${l.kind}`}>
                      {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
                      {l.text}
                    </div>
                  ))}
                </pre>
              )}
            </article>
          ))
        )}
      </section>
    </>
  )
}

export type LedgerAgent = AgentView & { skills: Record<string, number> } & {
  activity: null | { verb: string; ticksRemaining: number }
}

/** What they carry, what they can do, how they are, and what they have written of others. */
export function PersonLedgerView({
  agent,
  tick,
  carrying,
  ledger,
  nameOf = (id) => id,
}: {
  agent: LedgerAgent
  tick: number
  carrying: readonly { id: string; kind: string; qty: number }[]
  ledger: readonly LedgerRow[] | null
  nameOf?: (id: string) => string
}) {
  return (
    <>
      <section className="sheet-block">
        <h3 className="sheet-h">Body</h3>
        <NeedBar label="Food" value={agent.needs.hunger} />
        <NeedBar label="Rest" value={agent.needs.energy} />
        <NeedBar label="Warmth" value={agent.needs.warmth} />
        <NeedBar label="Company" value={agent.needs.social} />
        <NeedBar label="Health" value={agent.hp} />
        {agent.injuries.length > 0 && (
          <p>{agent.injuries.map((i) => `${i.kind} injury (day ${i.day})`).join(', ')}</p>
        )}
        {/* The page header already prints the state, so this line carries only what the
            header cannot: how long there is left to go. */}
        {agent.activity !== null && (
          <p>{`${stateWord(agent, tick)} — ${agent.activity.ticksRemaining} min to go`}</p>
        )}
      </section>

      <section className="sheet-block">
        <h3 className="sheet-h">Carrying</h3>
        {carrying.length === 0 ? (
          <p>Empty hands.</p>
        ) : (
          <ul>
            {carrying.map((it) => (
              <li key={it.id}>
                {it.kind} × {it.qty}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sheet-block">
        <h3 className="sheet-h">Skills</h3>
        {Object.keys(agent.skills).length === 0 ? (
          <p>{SKILLS_EMPTY}</p>
        ) : (
          <ul>
            {Object.entries(agent.skills).map(([track, xp]) => (
              <li key={track}>
                {track} — level {level(xp)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sheet-block">
        <h3 className="sheet-h">What they make of people</h3>
        {ledger === null ? (
          <Skeleton />
        ) : ledger.length === 0 ? (
          <p className="sheet-empty">{NOTHING_WRITTEN}</p>
        ) : (
          ledger.map((row) => (
            <article key={row.personId}>
              <h4>{nameOf(row.personId)}</h4>
              <p className="doc">{row.doc}</p>
            </article>
          ))
        )}
      </section>
    </>
  )
}

/** One person's own page. */
export function PersonPage({ tab, subject, store }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  const dispatches = useFeed(dispatchesFeed).data
  const agentId = subject?.kind === 'agent' ? subject.id : null
  // Rows are held WITH the person they were fetched for, so a new subject reads as "nothing
  // loaded" in the same render — the page can never show the previous person's ledger.
  const [docsOf, setDocsOf] = useState<{
    id: string
    journal: JournalRow[]
    ledger: LedgerRow[]
    personality: PersonalityRow[]
  } | null>(null)
  const docs = docsOf?.id === agentId ? docsOf : null

  useEffect(() => {
    if (agentId === null || docs !== null) return
    void Promise.all([
      fetchDoc<JournalRow>(agentId, 'journal'),
      fetchDoc<LedgerRow>(agentId, 'ledgers'),
      fetchDoc<PersonalityRow>(agentId, 'personality'),
    ]).then(([journal, ledger, personality]) => {
      setDocsOf({ id: agentId, journal, ledger, personality })
    })
  }, [agentId, docs])

  const a = agentId === null ? undefined : state?.agents[agentId]
  if (a === undefined) return <p className="sheet-empty">No such townsfolk.</p>

  const records = store.assetRecords()
  const portraitId = resolveAssetId(records, 'portrait', a.id)
  // no painted portrait yet → the v4 sprite bust stands in (smooth hi-res crop, not pixelated)
  const bust = portraitId === null ? bustStyle(records, a.id, 52) : null
  const carrying = Object.values(state!.items).filter(
    (it) => it.loc.t === 'agent' && it.loc.id === a.id,
  )

  return (
    <>
      <header className="person-head">
        {portraitId !== null ? (
          <img className="portrait" src={`/assets/${portraitId}.png`} alt="" />
        ) : bust !== null ? (
          <div
            className="portrait"
            style={{ ...bust, backgroundRepeat: 'no-repeat', imageRendering: 'auto' }}
          />
        ) : (
          <div className="portrait silhouette" />
        )}
        <div className="badges">
          <span className="badge">{ageBand(a.ageDays)}</span>
          <span className="badge">{stateWord(a, tick)}</span>
          {conditionsOf(a).map((c) => (
            <span key={c} className={c === 'unwell' ? 'badge ill' : 'badge'}>
              {CONDITION_WORD[c]}
            </span>
          ))}
        </div>
      </header>
      {tab === 'Bonds' ? (
        <Edges agentId={a.id} store={store} />
      ) : tab === 'Ledger' ? (
        <PersonLedgerView
          agent={a}
          tick={tick}
          carrying={carrying}
          ledger={docs?.ledger ?? null}
          nameOf={(id) => state?.agents[id]?.name ?? id}
        />
      ) : (
        <PersonStoryView
          thought={store.latestThought(a.id)}
          journal={docs?.journal ?? null}
          changes={docs === null ? null : changeLog(docs.personality)}
          biography={biographyOf(dispatches ?? EMPTY_DISPATCHES, a.id)}
        />
      )}
    </>
  )
}

/** This person's own edges, in the sentence the graph already writes for them. */
function Edges({ agentId, store }: { agentId: string; store: PageProps['store'] }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  const api = useFeed(bondsFeed).data
  const lineage = useFeed(lineageFeed).data ?? EMPTY_LINEAGE
  if (api === null) return <Skeleton />

  const nameOf = (id: string): string => state?.agents[id]?.name ?? id
  const mine = api.bonds.filter((b) => b.aId === agentId || b.bId === agentId)
  if (mine.length === 0) return <p className="sheet-empty">No ties yet.</p>

  return (
    <ul className="edges">
      {mine.map((b) => {
        const otherId = b.aId === agentId ? b.bId : b.aId
        const words = relationLine(
          bondTypeOf(agentId, otherId, lineage, api),
          bondLevel(bondWarmth(b, tick)),
          bondArc(b, tick),
          [nameOf(agentId), nameOf(otherId)],
        )
        return (
          <li key={b.id} className="edge">
            <p className="edge-line">{words}</p>
            <p className="edge-when">
              Since Day {tickToMoment(b.formedTick).day}, last on Day{' '}
              {tickToMoment(b.lastUpdatedTick).day}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
