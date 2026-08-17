import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { tileToScreen } from '../render/iso.js'
import { resolveAssetId } from '../render/textures.js'
import { bustStyle } from './rosterModel.js'
import { CONDITION_WORD, conditionsOf, stateWord } from './status.js'
import { diffLines } from './diffLines.js'

export const TAB_CACHE_MS = 30_000
export const NEED_LOW = 30
const EMPTY_COPY = 'Nothing written yet.'

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
  const [diffPick, setDiffPick] = useState<number[]>([])
  const [follow, setFollow] = useState(false)

  useEffect(() => {
    if (tab === 'ledger' && ledger === null) void fetchTab<LedgerRow>(agentId, 'ledger').then(setLedger)
    if (tab === 'journal' && journal === null) void fetchTab<JournalRow>(agentId, 'journal').then(setJournal)
    if (tab === 'personality' && personality === null) void fetchTab<PersonalityRow>(agentId, 'personality').then(setPersonality)
  }, [tab, agentId, ledger, journal, personality])

  useEffect(() => {
    setLedger(null)
    setJournal(null)
    setPersonality(null)
    setDiffPick([])
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

  const pickDiff = (version: number): void => {
    setDiffPick((prev) => {
      const next = prev.includes(version) ? prev.filter((v) => v !== version) : [...prev.slice(-1), version]
      return next
    })
  }

  const diffDocs =
    diffPick.length === 2 && personality !== null
      ? ([personality.find((p) => p.version === diffPick[0]), personality.find((p) => p.version === diffPick[1])] as const)
      : null

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

      <section className="block">
        <h3>Thought</h3>
        <p className="thought-line" aria-live="polite">{thought !== null ? `“${thought.text}”` : 'Their mind is quiet.'}</p>
      </section>

      <section className="block">
        <h3>Body</h3>
        <NeedBar label="Food" value={a.needs.hunger} />
        <NeedBar label="Rest" value={a.needs.energy} />
        <NeedBar label="Warmth" value={a.needs.warmth} />
        <NeedBar label="Company" value={a.needs.social} />
        <p>
          Health {a.hp}
          {a.injuries.length > 0 && ` — ${a.injuries.map((i) => `${i.kind} injury (day ${i.day})`).join(', ')}`}
        </p>
      </section>

      <section className="block">
        <h3>Doing</h3>
        <p>
          {a.activity !== null
            ? `${stateWord(a, tick)} — ${a.activity.ticksRemaining} min to go`
            : stateWord(a, tick)}
        </p>
      </section>

      <section className="block">
        <h3>Carrying</h3>
        {carrying.length === 0 ? <p>Empty hands.</p> : (
          <ul>{carrying.map((it) => <li key={it.id}>{it.kind} × {it.qty}</li>)}</ul>
        )}
      </section>

      <section className="block">
        <h3>Skills</h3>
        {Object.keys(a.skills).length === 0 ? <p>Still learning everything.</p> : (
          <ul>{Object.entries(a.skills).map(([track, xp]) => <li key={track}>{track} — level {level(xp)}</li>)}</ul>
        )}
      </section>

      <nav className="lens-tabs">
        {(['ledger', 'journal', 'personality'] as const).map((t) => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t === 'ledger' ? 'People' : t === 'journal' ? 'Journal' : 'Character'}
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
      {tab === 'personality' && (
        <section className="block tab-body">
          {personality === null ? <p>…</p> : personality.length === 0 ? <p>{EMPTY_COPY}</p> : (
            <>
              <div className="badges">
                {personality.map((p) => (
                  <button key={p.version} className={diffPick.includes(p.version) ? 'tab active' : 'tab'} onClick={() => pickDiff(p.version)}>
                    v{p.version}
                  </button>
                ))}
              </div>
              {diffDocs !== null && diffDocs[0] !== undefined && diffDocs[1] !== undefined ? (
                <pre className="diff">
                  {diffLines(diffDocs[0].doc, diffDocs[1].doc).map((l, i) => (
                    <div key={i} className={`diff-line ${l.kind}`}>{l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}{l.text}</div>
                  ))}
                </pre>
              ) : (
                <p className="doc">{personality.at(-1)?.doc}</p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
