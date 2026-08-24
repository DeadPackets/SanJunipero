import { useEffect, useState, useSyncExternalStore } from 'react'
import { BondsResponseSchema, ChronicleResponseSchema } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { LENSES, type Lens } from './route.js'
import {
  lensCountsFor, lensHints, townStats, weatherGlyph,
  type LensHint, type TownStats, type WeatherGlyph,
} from './townStats.js'

// The bond count is history, not a tick reading — a slow beat keeps the badge honest without
// putting a fetch on the world's clock.
export const BOND_COUNT_REFETCH_MS = 60_000
/** The chronicle's own beat, matching `ChroniclePanel.CHRONICLE_REFETCH_MS`: the badge and the
 *  panel read the same endpoint, so they should go stale at the same rate too. */
export const CHRONICLE_COUNT_REFETCH_MS = 20_000

// chrome copy speaks about townsfolk, never machinery (spec §5)
export const LENS_LABELS: Record<Lens, string> = {
  map: 'Town', inspector: 'Townsfolk', chronicle: 'Chronicle', discoveries: 'What they made',
  society: 'Bonds', director: 'Moments', laws: 'World Laws',
}

export const GLYPH_PX = 8   // the glyph grid; rendered at 2× so it stays on whole pixels

// Decorative: the weather word beside it carries the meaning, so the glyph stays out of the
// accessibility tree instead of being read twice.
function Glyph({ glyph }: { glyph: WeatherGlyph }) {
  return (
    <svg
      className="strip-glyph" viewBox={`0 0 ${GLYPH_PX} ${GLYPH_PX}`}
      width={GLYPH_PX * 2} height={GLYPH_PX * 2}
      shapeRendering="crispEdges" aria-hidden="true" focusable="false"
    >
      {glyph.pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

// The documentary strip: what day it is, what the sky is doing, how many are still walking.
export function StatusStripView({ stats }: { stats: TownStats }) {
  const glyph = weatherGlyph(stats.weather)
  const gone = stats.total - stats.alive
  return (
    <div className="status-strip" role="group" aria-label="The town right now">
      <span className="strip-cell strip-clock">
        <Glyph glyph={glyph} />
        <span className="strip-num" aria-label={`Day ${stats.day}, ${stats.time}`}>
          Day {stats.day} <i>{stats.time}</i>
        </span>
      </span>
      <span className="strip-rule" aria-hidden="true" />
      <span className="strip-cell strip-weather">{glyph.label}</span>
      <span className="strip-cell strip-people">
        <span className="strip-num" aria-label={`${stats.alive} townsfolk walking`}>
          Townsfolk <i>{stats.alive}</i>
        </span>
        {gone > 0 && (
          <span className="strip-gone" aria-label={`${gone} remembered`}>· <i>{gone}</i> remembered</span>
        )}
      </span>
    </div>
  )
}

// Reads the VIEWED tick, so scrubbing back moves the clock with the town.
export function StatusStrip({ store }: { store: WorldStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  return <StatusStripView stats={townStats(state, tick)} />
}

export function LensTabsView({ lens, hints, onNav }: { lens: Lens; hints: LensHint[]; onNav: (l: Lens) => void }) {
  const by = new Map(hints.map((h) => [h.lens, h]))
  return (
    <nav className="lens-tabs" aria-label="Lenses — left and right arrow keys move between them">
      {LENSES.map((l) => {
        const hint = by.get(l)!
        return (
          <button
            key={l}
            className={l === lens ? 'tab active' : 'tab'}
            aria-current={l === lens ? 'page' : undefined}
            aria-label={`${LENS_LABELS[l]} — ${hint.hint}`}
            title={hint.hint}
            onClick={() => onNav(l)}
          >
            {LENS_LABELS[l]}
            {hint.count !== null && <span className="tab-count" aria-hidden="true">{hint.count}</span>}
          </button>
        )
      })}
    </nav>
  )
}

/** ★ ONE READER, TWO BADGES, AND EACH READS ITS OWN PANEL'S ENDPOINT — how many rows a history
 *  endpoint is holding, on that endpoint's own slow beat, so no count rides the world's clock.
 *  `null` until the first answer and after any failure: no badge is better than a wrong one,
 *  which is the whole subject of the note over `chronicle` below. */
function useHistoryCount(
  url: string, rows: (body: unknown) => number | null, everyMs: number,
): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void fetch(url)
        .then(async (r) => (r.ok ? rows(await r.json()) : null))
        .then((n) => { if (alive && n !== null) setCount(n) })
        .catch(() => { /* no badge is better than a wrong one */ })
    }
    load()
    const timer = setInterval(load, everyMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // `rows` is a module-level parser, not a prop — re-subscribing on it would restart the beat
    // every render. The url and its beat are the identity of the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, everyMs])
  return count
}

const bondRows = (body: unknown): number | null => {
  const p = BondsResponseSchema.safeParse(body)
  return p.success ? p.data.bonds.length : null
}
const chronicleRows = (body: unknown): number | null => {
  const p = ChronicleResponseSchema.safeParse(body)
  return p.success ? p.data.entries.length : null
}

// The lens bar subscribes on its own so the counts can tick without re-rendering App and,
// with it, the Pixi stage.
export function LensTabs({ store, lens, onNav }: { store: WorldStore; lens: Lens; onNav: (l: Lens) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  const bonds = useHistoryCount('/api/bonds', bondRows, BOND_COUNT_REFETCH_MS)
  // ★ THE SAME ENDPOINT `ChroniclePanel` LISTS FROM — the ledger the chronicle lens actually
  // opens on — so the badge and the panel behind it can never again disagree. It used to count
  // the live socket feed instead: `CHRONICLE 0` over sixteen entries, on the first screen a
  // viewer sees. See the note over `lensHints`.
  const chronicle = useHistoryCount('/api/chronicle', chronicleRows, CHRONICLE_COUNT_REFETCH_MS)
  const stats = townStats(state, tick)
  return <LensTabsView lens={lens} hints={lensHints(stats, lensCountsFor(stats, chronicle, bonds))} onNav={onNav} />
}
