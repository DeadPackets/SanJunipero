import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { tileToScreen } from '../render/iso.js'
import { resolveAssetId } from '../render/textures.js'
import { bustStyle } from './rosterModel.js'
import { CONDITION_WORD, conditionsOf, stateWord, type AgentView } from './status.js'
import {
  CHANGE_EMPTY, SKILLS_EMPTY, THOUGHT_EMPTY, changeLog, hasChanged, type ChangeEntry,
} from './becoming.js'

export const TAB_CACHE_MS = 30_000
export const NEED_LOW = 30
const EMPTY_COPY = 'Nothing written yet.'

/** Two tabs a viewer picks between, plus the personality feed the panel always reads. */
type Tab = 'ledger' | 'journal' | 'personality'
type LedgerRow = { personId: string; doc: string; updatedDay: number }
type JournalRow = { tick: number; day: number; text: string }
type PersonalityRow = { version: number; day: number; doc: string; edit: string }

const ENDPOINT: Record<Tab, string> = { ledger: 'ledgers', journal: 'journal', personality: 'personality' }

const cache = new Map<string, { at: number; rows: unknown[] }>()
async function fetchTab<T>(agentId: string, tab: Tab): Promise<T[]> {
  const key = `${agentId}:${tab}`
  const hit = cache.get(key)
  if (hit !== undefined && performance.now() - hit.at < TAB_CACHE_MS) return hit.rows as T[]
  const res = await fetch(`/api/agent/${encodeURIComponent(agentId)}/${ENDPOINT[tab]}`)
  const rows = res.ok ? ((await res.json()) as T[]) : []
  cache.set(key, { at: performance.now(), rows })
  return rows
}

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

/** What the body view needs of a person: a structural read, so a test needs no whole world. */
export type InspectorAgent = AgentView & { skills: Record<string, number> } & {
  activity: null | { verb: string; ticksRemaining: number }
}

/**
 * ★ WHAT A RUN HAS MADE OF THIS PERSON — the panel's substance, with the store taken out of it.
 *
 * Every section here is sourced to something the run recorded: a thought the observer wrote
 * down, a body the engine ticked, an activity the mind chose, things the world put in their
 * hands, crafts they have practised, and the days their own document changed. NOTHING here is
 * handed to them at genesis, and where the record is empty it says the RECORD is empty — the
 * two placeholders that described an empty person instead ("Their mind is quiet.", "Still
 * learning everything.") are deleted, not softened.
 */
export function InspectorBodyView(
  { agent, tick, thought, carrying, changes }: {
    agent: InspectorAgent
    tick: number
    thought: { text: string } | null
    carrying: ReadonlyArray<{ id: string; kind: string; qty: number }>
    changes: readonly ChangeEntry[]
  },
) {
  const moved = hasChanged(changes)
  return (
    <>
      <section className="block">
        <h3>Thought</h3>
        <p className="thought-line" aria-live="polite">
          {thought !== null ? `“${thought.text}”` : THOUGHT_EMPTY}
        </p>
      </section>

      <section className="block">
        <h3>Body</h3>
        <NeedBar label="Food" value={agent.needs.hunger} />
        <NeedBar label="Rest" value={agent.needs.energy} />
        <NeedBar label="Warmth" value={agent.needs.warmth} />
        <NeedBar label="Company" value={agent.needs.social} />
        <p>
          Health {agent.hp}
          {agent.injuries.length > 0
            && ` — ${agent.injuries.map((i) => `${i.kind} injury (day ${i.day})`).join(', ')}`}
        </p>
      </section>

      {/* WHAT THE BROWSER CAUGHT: the header badge already prints the state, so an idle
          person read "Asleep" twice on one panel — U13's own defect, one level down. The
          section now carries only what the badge cannot: how long there is left to go. */}
      {agent.activity !== null && (
        <section className="block">
          <h3>Doing</h3>
          <p>{`${stateWord(agent, tick)} — ${agent.activity.ticksRemaining} min to go`}</p>
        </section>
      )}

      <section className="block">
        <h3>Carrying</h3>
        {carrying.length === 0 ? <p>Empty hands.</p> : (
          <ul>{carrying.map((it) => <li key={it.id}>{it.kind} × {it.qty}</li>)}</ul>
        )}
      </section>

      <section className="block">
        <h3>Skills</h3>
        {Object.keys(agent.skills).length === 0 ? <p>{SKILLS_EMPTY}</p> : (
          <ul>{Object.entries(agent.skills).map(([track, xp]) => <li key={track}>{track} — level {level(xp)}</li>)}</ul>
        )}
      </section>

      {/* The one legitimate identity surface in the product, re-framed. It leads with the
          LATEST document and the most recent edit; a person with one version has moved
          nothing yet and is told so, rather than handed v1 as a character sheet. */}
      <section className="block">
        <h3>How they have changed</h3>
        {!moved ? <p className="doc">{CHANGE_EMPTY}</p> : changes.map((e) => (
          <article key={e.version} className="change-entry">
            <p className="change-head">
              <span className="stamp">Day {e.day}</span> {e.edit}
            </p>
            {e.diff.length > 0 && (
              <pre className="diff">
                {e.diff.map((l, i) => (
                  <div key={i} className={`diff-line ${l.kind}`}>
                    {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}{l.text}
                  </div>
                ))}
              </pre>
            )}
          </article>
        ))}
      </section>
    </>
  )
}

// The way back to the roster. A viewer who picked one person had no route back to the list —
// this is the visible one; the TOWNSFOLK nav item and Escape are the other two.
export function BackToRoster({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="roster-back" onClick={onBack}>
      <span aria-hidden="true">&#8592;</span> All townsfolk
    </button>
  )
}

export function InspectorPanel(
  { store, agentId, scene, onBack }:
  { store: WorldStore; agentId: string; scene: Scene | null; onBack?: () => void },
) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  const [tab, setTab] = useState<Tab>('ledger')
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null)
  const [journal, setJournal] = useState<JournalRow[] | null>(null)
  const [personality, setPersonality] = useState<PersonalityRow[] | null>(null)
  const [follow, setFollow] = useState(false)

  useEffect(() => {
    if (tab === 'ledger' && ledger === null) void fetchTab<LedgerRow>(agentId, 'ledger').then(setLedger)
    if (tab === 'journal' && journal === null) void fetchTab<JournalRow>(agentId, 'journal').then(setJournal)
    // no longer behind a tab: what changed about a person is the panel's own subject now
    if (personality === null) void fetchTab<PersonalityRow>(agentId, 'personality').then(setPersonality)
  }, [tab, agentId, ledger, journal, personality])

  useEffect(() => {
    setLedger(null)
    setJournal(null)
    setPersonality(null)
  }, [agentId])

  // follow-cam: the scene's follow rig eases toward the agent's sprite; a user
  // drag takes the camera back and un-presses the button (never lie about state)
  useEffect(() => {
    if (!follow || scene === null) return
    scene.setFollow(() => {
      const anchor = scene.anchorOf?.(agentId)
      if (anchor !== undefined && anchor !== null) return anchor
      const a = store.getState()?.agents[agentId]
      if (a === undefined) return null
      const { sx, sy } = tileToScreen(a.x, a.y)
      return { x: sx, y: sy }
    })
    const offEnd = scene.onFollowEnd(() => setFollow(false))
    // following someone through a door takes the camera in with them (C10 T11)
    scene.interior?.setFollowed(agentId)
    return () => {
      offEnd()
      scene.setFollow(null)
      scene.interior?.setFollowed(null)
      scene.interior?.setActive(null)
    }
  }, [follow, scene, store, agentId])

  const a = state?.agents[agentId]
  if (a === undefined) {
    return (
      <div className="inspector-panel">
        {onBack ? <BackToRoster onBack={onBack} /> : null}
        No such townsfolk.
      </div>
    )
  }

  const thought = store.latestThought(agentId)
  const carrying = Object.values(state!.items).filter((it) => it.loc.t === 'agent' && it.loc.id === agentId)
  const records = store.assetRecords()
  const portraitId = resolveAssetId(records, 'portrait', agentId)
  // no painted portrait yet → the v4 sprite bust stands in (smooth hi-res crop, not pixelated)
  const bust = portraitId === null ? bustStyle(records, agentId, 52) : null

  return (
    <div className="inspector-panel" data-tick={tick}>
      {onBack ? <BackToRoster onBack={onBack} /> : null}
      <header className="inspector-head">
        {portraitId !== null ? (
          <img className="portrait" src={`/assets/${portraitId}.png`} alt="" />
        ) : bust !== null ? (
          <div className="portrait" style={{ ...bust, backgroundRepeat: 'no-repeat', imageRendering: 'auto' }} />
        ) : (
          <div className="portrait silhouette" />
        )}
        <div>
          <h2 className="px-title">{a.name}</h2>
          {/* ONE state and its conditions, from the one vocabulary (task 79). This badge row
              used to carry "asleep"/"awake"/"at rest forever" beside a separate unwell chip —
              three words for one fact and a synonym pair among them. */}
          <div className="badges">
            <span className="badge">{ageBand(a.ageDays)}</span>
            <span className="badge">{stateWord(a, tick)}</span>
            {conditionsOf(a).map((c) => (
              <span key={c} className={c === 'unwell' ? 'badge ill' : 'badge'}>{CONDITION_WORD[c]}</span>
            ))}
          </div>
        </div>
        <button
          className={follow ? 'tab active follow' : 'tab follow'}
          aria-pressed={follow}
          onClick={() => setFollow((f) => !f)}
        >
          {follow ? 'Following' : 'Follow'}
        </button>
      </header>

      <InspectorBodyView
        agent={a}
        tick={tick}
        thought={thought}
        carrying={carrying}
        changes={personality === null ? [] : changeLog(personality)}
      />

      <nav className="lens-tabs">
        {(['ledger', 'journal'] as const).map((t) => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t === 'ledger' ? 'People' : 'Journal'}
          </button>
        ))}
      </nav>

      {tab === 'ledger' && (
        <section className="block tab-body">
          {ledger === null ? <p>…</p> : ledger.length === 0 ? <p>{EMPTY_COPY}</p> : ledger.map((row) => (
            <article key={row.personId}>
              <h4>{row.personId}</h4>
              <p className="doc">{row.doc}</p>
            </article>
          ))}
        </section>
      )}
      {tab === 'journal' && (
        <section className="block tab-body">
          {journal === null ? <p>…</p> : journal.length === 0 ? <p>{EMPTY_COPY}</p> : journal.map((row, i) => (
            <p key={i} className="doc"><span className="stamp">Day {row.day}</span> {row.text}</p>
          ))}
        </section>
      )}
    </div>
  )
}
