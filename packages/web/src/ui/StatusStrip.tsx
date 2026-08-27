import { useSyncExternalStore } from 'react'
import { BondsCountSchema, ChronicleCountSchema } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { LENSES, LENS_LABELS, type Lens } from './route.js'
import { usePolled } from './useEndpoint.js'
import {
  lensCountsFor,
  lensHints,
  townStats,
  weatherGlyph,
  type LensHint,
  type TownStats,
  type WeatherGlyph,
} from './townStats.js'

// The bond count is history, not a tick reading — a slow beat keeps the badge honest without
// putting a fetch on the world's clock.
export const BOND_COUNT_REFETCH_MS = 60_000
/** The chronicle's own beat, matching `ChroniclePanel.CHRONICLE_REFETCH_MS`: the badge and the
 *  panel read the same endpoint, so they should go stale at the same rate too. */
export const CHRONICLE_COUNT_REFETCH_MS = 20_000

export const GLYPH_PX = 8 // the glyph grid; rendered at 2× so it stays on whole pixels

// Decorative: the weather word beside it carries the meaning, so the glyph stays out of the
// accessibility tree instead of being read twice.
function Glyph({ glyph }: { glyph: WeatherGlyph }) {
  return (
    <svg
      className="strip-glyph"
      viewBox={`0 0 ${GLYPH_PX} ${GLYPH_PX}`}
      width={GLYPH_PX * 2}
      height={GLYPH_PX * 2}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {glyph.pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

// The documentary strip: what the sky is doing, and how many are still walking. The clock is
// the topbar's badge and was read off the same viewed tick here — one fact, said twice.
export function StatusStripView({ stats }: { stats: TownStats }) {
  const glyph = weatherGlyph(stats.weather)
  const gone = stats.total - stats.alive
  return (
    <div className="status-strip" role="group" aria-label="The town right now">
      <span className="strip-cell strip-weather">
        <Glyph glyph={glyph} />
        {glyph.label}
      </span>
      <span className="strip-cell strip-people">
        <span className="strip-num" aria-label={`${stats.alive} townsfolk walking`}>
          Townsfolk <i>{stats.alive}</i>
        </span>
        {gone > 0 && (
          <span className="strip-gone" aria-label={`${gone} remembered`}>
            · <i>{gone}</i> remembered
          </span>
        )}
      </span>
    </div>
  )
}

// Reads the VIEWED tick, so scrubbing back moves the count with the town.
export function StatusStrip({ store }: { store: WorldStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  return <StatusStripView stats={townStats(state, tick)} />
}

export function LensTabsView({
  lens,
  hints,
  onNav,
}: {
  lens: Lens
  hints: LensHint[]
  onNav: (l: Lens) => void
}) {
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
            onClick={() => {
              onNav(l)
            }}
          >
            {LENS_LABELS[l]}
            {hint.count !== null && (
              <span className="tab-count" aria-hidden="true">
                {hint.count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

const bondRows = (body: unknown): number | null => {
  const p = BondsCountSchema.safeParse(body)
  return p.success ? p.data.count : null
}
const chronicleRows = (body: unknown): number | null => {
  const p = ChronicleCountSchema.safeParse(body)
  return p.success ? p.data.count : null
}

// The lens bar subscribes on its own so the counts can tick without re-rendering App and,
// with it, the Pixi stage.
export function LensTabs({
  store,
  lens,
  onNav,
}: {
  store: WorldStore
  lens: Lens
  onNav: (l: Lens) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  // A `Bond` carries its whole history, so counting by downloading cost 83.7 MB at sim-day 20 of
  // a talkative town — every 60 s, per viewer, for a two-digit badge.
  const bonds = usePolled('/api/bonds/count', bondRows, BOND_COUNT_REFETCH_MS).data
  // Counted on the server rather than by downloading the ledger the panel lists from, so the
  // badge and the panel can never disagree.
  const chronicle = usePolled(
    '/api/chronicle/count',
    chronicleRows,
    CHRONICLE_COUNT_REFETCH_MS,
  ).data
  const stats = townStats(state, tick)
  return (
    <LensTabsView
      lens={lens}
      hints={lensHints(stats, lensCountsFor(stats, chronicle, bonds))}
      onNav={onNav}
    />
  )
}
