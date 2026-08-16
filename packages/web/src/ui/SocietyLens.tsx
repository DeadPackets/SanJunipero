import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { BOND_KINDS, BondsResponseSchema, tickToMoment, type Bond, type BondKind, type BondsResponse } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { BondDetailPanel } from './BondDetailPanel.js'
import {
  BOND_COLORS, BOND_KIND_LABEL, bondTooltip, maxBondStrength, toBondGraph,
  type BondLink, type BondNode, type PeopleIndex,
} from './bondsModel.js'
import { EMPTY_COPY } from './townStats.js'

export const REFETCH_MS = 30_000
const HALO_COLOR = '#F4E289'
const EMPTY_API: BondsResponse = { bonds: [], asOfTick: 0 }

export function SocietyLens({ store, onPick }: { store: WorldStore; onPick: (agentId: string) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [api, setApi] = useState<BondsResponse | null>(null)
  const [hidden, setHidden] = useState<Set<BondKind>>(new Set())
  const [selected, setSelected] = useState<Bond | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 800, h: 600 })

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void fetch('/api/bonds')
        .then(async (r) => (r.ok ? BondsResponseSchema.safeParse(await r.json()) : null))
        .then((parsed) => {
          if (alive && parsed?.success === true) setApi(parsed.data)
        })
        .catch(() => { /* the town keeps its ties whether or not we can read them */ })
    }
    load()
    const timer = setInterval(load, REFETCH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const el = boxRef.current
    if (el === null) return
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Names come from the world the viewer already holds — the bonds endpoint carries ties, not
  // people, so a rename can never disagree with the map.
  const people: PeopleIndex = useMemo(() => {
    const out: Record<string, { name: string; alive: boolean }> = {}
    for (const a of Object.values(state?.agents ?? {})) out[a.id] = { name: a.name, alive: a.alive }
    return out
  }, [state])

  const graph = useMemo(() => toBondGraph(api ?? EMPTY_API, people), [api, people])
  const links = graph.links.filter((l) => !hidden.has(l.kind))
  const maxStrength = maxBondStrength(api ?? EMPTY_API)

  const toggle = (kind: BondKind): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  return (
    <div className="society-lens" ref={boxRef}>
      <div className="society-legend" role="group" aria-label="Bond kinds">
        {BOND_KINDS.map((k) => (
          <button
            key={k}
            className={hidden.has(k) ? 'legend-chip off' : 'legend-chip'}
            aria-pressed={!hidden.has(k)}
            onClick={() => toggle(k)}
          >
            <span className="legend-swatch" style={{ background: BOND_COLORS[k] }} aria-hidden="true" />
            {BOND_KIND_LABEL[k]}
          </button>
        ))}
        {api !== null && (
          <span className="legend-stamp">
            as of Day {tickToMoment(api.asOfTick).day} {tickToMoment(api.asOfTick).time}
          </span>
        )}
      </div>

      {api !== null && api.bonds.length === 0 && <p className="society-empty">{EMPTY_COPY.bonds}</p>}

      {selected !== null && (
        <BondDetailPanel
          bond={selected}
          people={people}
          maxStrength={maxStrength}
          onClose={() => setSelected(null)}
        />
      )}

      <ForceGraph2D
        width={dims.w}
        height={dims.h}
        backgroundColor="rgba(0,0,0,0)"
        graphData={{ nodes: graph.nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) }}
        nodeVal={(n) => (n as BondNode).size}
        nodeLabel={(n) => (n as BondNode).name}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          // pixel token: integer-snapped square slab with ink ring, ledge, and bevel
          const n = node as BondNode & { x?: number; y?: number }
          if (n.x === undefined || n.y === undefined) return
          ctx.imageSmoothingEnabled = false
          const side = Math.max(14, Math.round(Math.sqrt(n.size) * 5))
          const x = Math.round(n.x) - Math.round(side / 2)
          const y = Math.round(n.y) - Math.round(side / 2)
          ctx.fillStyle = '#241F2B'
          ctx.fillRect(x + 2, y + 2, side, side)
          ctx.fillStyle = n.color
          ctx.fillRect(x, y, side, side)
          ctx.strokeStyle = '#43394A'
          ctx.lineWidth = 2
          ctx.strokeRect(x + 1, y + 1, side - 2, side - 2)
          ctx.fillStyle = 'rgba(255,246,233,0.35)'
          ctx.fillRect(x + 2, y + 2, side - 4, 2)
          ctx.fillRect(x + 2, y + 2, 2, side - 4)
          if (!n.alive) {
            ctx.strokeStyle = HALO_COLOR
            ctx.lineWidth = 2
            ctx.strokeRect(x - 4, y - 4, side + 8, side + 8)
          }
          const fontSize = Math.max(10 / globalScale, 4)
          ctx.font = `${fontSize}px Silkscreen, monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          const lx = Math.round(n.x)
          const ly = y + side + 4
          ctx.fillStyle = '#241F2B'
          ctx.fillText(n.name, lx + 1, ly + 1)
          ctx.fillStyle = '#FFF6E9'
          ctx.fillText(n.name, lx, ly)
        }}
        nodeColor={(n) => (n as BondNode).color}
        linkColor={(l) => (l as BondLink).color}
        linkWidth={(l) => (l as BondLink).width}
        linkLineDash={(l) => ((l as BondLink).kind === 'rival' ? [2, 4] : null)}
        linkLabel={(l) => bondTooltip((l as BondLink).bond, people)}
        onLinkClick={(l) => setSelected((l as BondLink).bond)}
        onNodeClick={(n) => onPick((n as BondNode).id)}
      />
    </div>
  )
}
