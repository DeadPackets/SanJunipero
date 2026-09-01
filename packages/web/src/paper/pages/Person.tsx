import { useSyncExternalStore } from 'react'
import { SOMEONE, agentName, bondLevel, bondWarmth, tickToMoment } from '@sj/shared'
import { resolveAssetId } from '../../render/textures.js'
import { bustStyle } from '../../ui/bustStyle.js'
import { biographyOf, EMPTY_DISPATCHES } from '../../ui/dispatches.js'
import { bondsFeed, dispatchesFeed, lineageFeed } from '../../ui/feeds.js'
import { useFeed, usePolled } from '../../ui/useEndpoint.js'
import { CONDITION_WORD, conditionsOf, stateWord, type AgentView } from '../../ui/status.js'
import {
  CHANGE_EMPTY,
  SKILLS_EMPTY,
  THOUGHT_EMPTY,
  changeLog,
  hasChanged,
  type ChangeEntry,
  type PersonalityRow,
} from '../../ui/becoming.js'
import { EMPTY_LINEAGE, bondArc, bondTypeOf, relationLine } from '../../ui/bondModel2.js'
import { skillPhrase } from '../../ui/roster/expand.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { Skeleton } from './Skeleton.js'
import type { PageProps } from './types.js'

const NEED_LOW = 30
export type LedgerRow = { personId: string; doc: string; updatedDay: number }
export type JournalRow = { tick: number; day: number; text: string; kind: 'journal' | 'dream' }

const docUrl = (agentId: string | null, doc: string): string | null =>
  agentId === null ? null : `/api/agent/${encodeURIComponent(agentId)}/${doc}`

const journalRows = (b: unknown): JournalRow[] | null =>
  Array.isArray(b) ? (b as JournalRow[]) : null
const ledgerRows = (b: unknown): LedgerRow[] | null =>
  Array.isArray(b) ? (b as LedgerRow[]) : null
const changeRows = (b: unknown): PersonalityRow[] | null =>
  Array.isArray(b) ? (b as PersonalityRow[]) : null

/** A dream is the mind's, but it is not something the mind wrote down — say which is which. */
const journalStamp = (row: JournalRow): string =>
  row.kind === 'dream' ? `Day ${row.day}, a dream` : `Day ${row.day}`

function ageBand(ageDays: number): string {
  const years = Math.floor(ageDays / 364)
  if (years < 18) return 'young'
  if (years < 60) return 'grown'
  return 'elder'
}

function NeedBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="need-row">
      <span className="need-label" id={`need-${label}`}>
        {label}
      </span>
      <div
        className="need-track"
        role="meter"
        aria-labelledby={`need-${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-valuetext={`${v} of 100`}
      >
        <div className={v < NEED_LOW ? 'need-fill low' : 'need-fill'} style={{ width: `${v}%` }} />
      </div>
    </div>
  )
}

/** Every section is sourced to the run's record; where it is empty, it says the record is empty. */
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
      <section className="block">
        <h3 className="feed-head">Thought</h3>
        <p className="thought-line">{thought !== null ? `“${thought.text}”` : THOUGHT_EMPTY}</p>
      </section>

      <section className="block">
        <h3 className="feed-head">Journal</h3>
        {journal === null ? (
          <Skeleton />
        ) : journal.length === 0 ? (
          <p className="feed-empty">{EMPTY_COPY.written}</p>
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
      <section className="block">
        <h3 className="feed-head">What is written of them</h3>
        {biography === null ? (
          <p className="doc">{EMPTY_COPY.biography}</p>
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
      <section className="block">
        <h3 className="feed-head">How they have changed</h3>
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

export function PersonLedgerView({
  agent,
  tick,
  carrying,
  ledger,
  nameOf = () => SOMEONE,
}: {
  agent: LedgerAgent
  tick: number
  carrying: readonly { id: string; kind: string; qty: number }[]
  ledger: readonly LedgerRow[] | null
  nameOf?: (id: string) => string
}) {
  return (
    <>
      <section className="block">
        <h3 className="feed-head">Body</h3>
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

      <section className="block">
        <h3 className="feed-head">Carrying</h3>
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

      <section className="block">
        <h3 className="feed-head">Skills</h3>
        {Object.keys(agent.skills).length === 0 ? (
          <p>{SKILLS_EMPTY}</p>
        ) : (
          <ul>
            {Object.entries(agent.skills).map(([track, xp]) => (
              <li key={track}>{skillPhrase(track, xp)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <h3 className="feed-head">What they make of people</h3>
        {ledger === null ? (
          <Skeleton />
        ) : ledger.length === 0 ? (
          <p className="feed-empty">{EMPTY_COPY.written}</p>
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

export function PersonPage({ tab, subject, store }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const dispatches = useFeed(dispatchesFeed).data
  const agentId = subject?.kind === 'agent' ? subject.id : null
  // A changed URL is a new read, so the page can never show the previous person's documents,
  // and a tab nobody opened reads `null` — the endpoint layer's own "do not read".
  const story = tab !== 'Bonds' && tab !== 'Ledger'
  const journal = usePolled(story ? docUrl(agentId, 'journal') : null, journalRows)
  const personality = usePolled(story ? docUrl(agentId, 'personality') : null, changeRows)
  const ledger = usePolled(tab === 'Ledger' ? docUrl(agentId, 'ledgers') : null, ledgerRows)

  const a = agentId === null ? undefined : state?.agents[agentId]
  if (a === undefined) return <p className="feed-empty">{EMPTY_COPY.noPerson}</p>

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
          ledger={ledger.data}
          nameOf={(id) => agentName(state?.agents, id)}
        />
      ) : (
        <PersonStoryView
          thought={store.latestThought(a.id)}
          journal={journal.data}
          changes={personality.data === null ? null : changeLog(personality.data)}
          biography={biographyOf(dispatches ?? EMPTY_DISPATCHES, a.id)}
        />
      )}
    </>
  )
}

function Edges({ agentId, store }: { agentId: string; store: PageProps['store'] }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const api = useFeed(bondsFeed).data
  const lineage = useFeed(lineageFeed).data ?? EMPTY_LINEAGE
  if (api === null) return <Skeleton />

  const mine = api.bonds.filter((b) => b.aId === agentId || b.bId === agentId)
  if (mine.length === 0) return <p className="feed-empty">{EMPTY_COPY.ties}</p>

  return (
    <ul className="edges">
      {mine.map((b) => {
        const otherId = b.aId === agentId ? b.bId : b.aId
        const words = relationLine(
          bondTypeOf(agentId, otherId, lineage, api),
          bondLevel(bondWarmth(b, tick)),
          bondArc(b, tick),
          [agentName(state?.agents, agentId), agentName(state?.agents, otherId)],
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
