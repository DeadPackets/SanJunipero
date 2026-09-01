import { useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { WEATHER_GLYPH } from '../ui/townStats.js'
import {
  ARC_BOX,
  ARC_PATH,
  arcPercent,
  dayWord,
  skyKind,
  skyToken,
  skyWord,
} from '../ui/skyModel.js'

const GLYPH_PX = 8
/** The token is drawn on the same eight-pixel grid the weather glyphs are. */
/** No fill: the sun and the moon take `currentColor` off `.sky-token`. */
const SUN: readonly (readonly [number, number])[] = [
  [3, 1],
  [4, 1],
  [2, 2],
  [3, 2],
  [4, 2],
  [5, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [5, 3],
  [3, 4],
  [4, 4],
  [0, 2],
  [7, 2],
  [0, 3],
  [7, 3],
]
const MOON: readonly (readonly [number, number])[] = [
  [3, 0],
  [4, 0],
  [2, 1],
  [5, 1],
  [1, 2],
  [5, 2],
  [1, 3],
  [5, 3],
  [2, 4],
  [5, 4],
  [3, 5],
  [4, 5],
]

function PixelGlyph({
  pixels,
  className,
}: {
  /** a fill of `null` takes the element's own colour, which is where the token lives */
  pixels: readonly (readonly [number, number, string?])[]
  className: string
}) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${GLYPH_PX} ${GLYPH_PX}`}
      width={GLYPH_PX * 2}
      height={GLYPH_PX * 2}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill ?? 'currentColor'} />
      ))}
    </svg>
  )
}

/** ★ THE SUN ARC — the one permanent mark over the town. Where the token sits on the curve says
 *  what hour it is before the words beside it are read at all; the words are the day, the season,
 *  the weather and the temperature. Not a live region: an hour announcing itself every minute of
 *  town time is one nobody can listen past. */
export function SkyArc({ store }: { store: WorldStore }) {
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  // Primitives, never the folded state object: `state.weather` is a fresh object every tick and
  // would re-render this mark sixty times for a sky that has not changed.
  const readKind = (): string => skyKind(store.getState())
  const readSky = (): string => skyWord(store.getState())
  const kind = useSyncExternalStore(store.subscribe, readKind, readKind)
  const sky = useSyncExternalStore(store.subscribe, readSky, readSky)

  const token = skyToken(tick)
  const at = arcPercent(token.along)
  const glyph = WEATHER_GLYPH[kind] ?? WEATHER_GLYPH['—']!

  return (
    <div className="sky-bar">
      <p className="sky-chip">
        <PixelGlyph className="sky-glyph" pixels={glyph.pixels} />
        {dayWord(tick)}
      </p>
      <div className="sky-arc">
        <svg
          className="sky-arc-line"
          viewBox={`0 0 ${ARC_BOX.w} ${ARC_BOX.h}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {/* The road carries its own ground: a deep under-stroke, then the honey dashes on it,
              so neither is read against whatever tile happens to be behind the bar. */}
          <path className="sky-arc-ground" d={ARC_PATH} />
          <path className="sky-arc-track" d={ARC_PATH} />
        </svg>
        <span
          className="sky-token"
          data-kind={token.kind}
          style={{ left: `${at.left}%`, top: `${at.top}%` }}
        >
          {/* `currentColor`, so the token's honey and cream stay in `:root` with every other
              colour the product uses rather than being retyped here. */}
          <PixelGlyph className="sky-glyph" pixels={token.kind === 'sun' ? SUN : MOON} />
        </span>
      </div>
      <p className="sky-chip">{sky}</p>
    </div>
  )
}
