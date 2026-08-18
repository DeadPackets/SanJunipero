import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { BondsResponseSchema, tickToMoment, type BondsResponse } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { TEXT_MIN_PX } from '../textFloor.js'
import { BondDetailPanel } from './BondDetailPanel.js'
import { LegendChip } from './LegendChip.js'
import { EMPTY_LINEAGE, type LineageLike } from './bondModel2.js'
import { toRelationGraph, relationLegend, type LegendRow, type RelationLink } from './relationGraph.js'
import type { BondNode, PeopleIndex } from './bondsModel.js'
import { EMPTY_COPY } from './townStats.js'

export const REFETCH_MS = 30_000
const HALO_COLOR = '#F4E289'
const EMPTY_API: BondsResponse = { bonds: [], asOfTick: 0 }

export function SocietyLens({ store, onPick }: { store: WorldStore; onPick: (agentId: string) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  const [api, setApi] = useState<BondsResponse | null>(null)
  const [lineage, setLineage] = useState<LineageLike>(EMPTY_LINEAGE)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // R6: the key is shut on arrival, so the graph is never explained by a card standing on it.
  const [keyOpen, setKeyOpen] = useState(false)
  const [selected, setSelected] = useState<RelationLink | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const [dims, setDims] = useState({ w: 800, h: 600 })

  // EDGE LENGTH IS THE LEVEL. `linkDistance` is not a component prop — the length lives on the
  // d3 link force, so it is set on the instance once the graph exists.
  useEffect(() => {
    const link = fgRef.current?.d3Force('link') as
      { distance: (f: (l: unknown) => number) => void } | undefined
    link?.distance((l: unknown) => (l as RelationLink).distance)
  }, [])

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
    void fetch('/api/lineage')
      .then(async (r) => (r.ok ? (await r.json()) as LineageLike : null))
      .then((l) => { if (l !== null && Array.isArray(l.parentOf)) setLineage(l) })
      .catch(() => { /* ancestry is a nice-to-have, never a requirement */ })
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
    for (const a of Object.values(state?.agents ?? {})) {
      if (a.alive) out[a.id] = { name: a.name, alive: true }
    }
    return out
  }, [state])

  const graph = useMemo(
    () => toRelationGraph(api ?? EMPTY_API, lineage, people, tick),
    [api, lineage, people, tick],
  )
  const legend = useMemo(() => relationLegend(), [])
  const key = (r: LegendRow): string => `${r.axis}:${r.key}`
  const links = graph.links.filter((l) =>
    !hidden.has(`level:${l.level}`) && !hidden.has(`type:${l.type}`) && !hidden.has(`arc:${l.arc.direction}`))

  // A shut key must not hide the fact that lines are being filtered out.
  const hiddenCount = hidden.size

  const toggle = (k: string): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  return (
    <div className="society-lens" ref={boxRef}>
      <div className="society-key" data-open={keyOpen ? 'yes' : 'no'}>
        <button
          type="button"
          className="key-summary"
          aria-expanded={keyOpen}
          aria-controls="society-key-body"
          onClick={() => setKeyOpen((v) => !v)}
        >
          {keyOpen ? 'Hide the key' : 'How to read this'}
          {hiddenCount > 0 && <span className="key-filtered">{hiddenCount} hidden</span>}
        </button>
        {keyOpen && (
          <div id="society-key-body" className="society-legend" role="group" aria-label="How to read this">
            {(['level', 'type', 'arc'] as const).map((axis) => (
              <div className="legend-axis" key={axis} data-axis={axis}>
                <span className="legend-axis-name">
                  {axis === 'level' ? 'How close' : axis === 'type' ? 'Family' : 'Which way'}
                </span>
                {legend.filter((r) => r.axis === axis).map((r) => (
                  <LegendChip key={key(r)} row={r} off={hidden.has(key(r))} onToggle={() => toggle(key(r))} />
                ))}
              </div>
            ))}
            {api !== null && (
              <span className="legend-stamp">
                as of Day {tickToMoment(api.asOfTick).day} {tickToMoment(api.asOfTick).time}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Nobody is missing from the picture any more, so the only honest empty state is a town
          in which nothing has passed between anyone yet. */}
      {api !== null && graph.links.length === 0 && graph.nodes.length > 0 && (
        <p className="society-empty">{EMPTY_COPY.bonds}</p>
      )}

      {selected !== null && api !== null && (
        <BondDetailPanel
          bond={api.bonds.find((b) => b.id === selected.id)!}
          people={people}
          type={selected.type}
          level={selected.level}
          arc={selected.arc}
          words={selected.words}
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
        ref={fgRef}
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
          // ctx is already scaled, so dividing by globalScale pins the label at TEXT_MIN_PX
          // on screen however far the graph is zoomed out.
          const fontSize = Math.max(TEXT_MIN_PX / globalScale, 4)
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
        linkColor={(l) => (l as RelationLink).color}
        linkWidth={(l) => ((l as RelationLink).strokeCount === 2 ? 3 : 1.5)}
        linkLineDash={(l) => (l as RelationLink).dash as number[] | null}
        linkLabel={(l) => (l as RelationLink).words}
        onLinkClick={(l) => setSelected(l as unknown as RelationLink)}
        onNodeClick={(n) => onPick((n as BondNode).id)}
      />
    </div>
  )
}
