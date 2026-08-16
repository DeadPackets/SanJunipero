import { useEffect, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { tickToMoment } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { HALO_COLOR, LINK_COLORS, toGraphData, type GraphNode, type LinkKind, type SocietyResponse } from './societyModel.js'
import { EMPTY_COPY } from './townStats.js'

export const REFETCH_MS = 30_000
const KINDS: LinkKind[] = ['talk', 'give', 'teach', 'attack']
const KIND_LABEL: Record<LinkKind, string> = { talk: 'Talked', give: 'Gave', teach: 'Taught', attack: 'Fought' }

export function SocietyLens({ store, onPick }: { store: WorldStore; onPick: (agentId: string) => void }) {
  const [api, setApi] = useState<SocietyResponse | null>(null)
  const [asOfTick, setAsOfTick] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<LinkKind>>(new Set())
  const boxRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 800, h: 600 })

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void fetch('/api/society')
        .then(async (r) => (r.ok ? ((await r.json()) as SocietyResponse) : null))
        .then((data) => {
          if (alive && data !== null) {
            setApi(data)
            setAsOfTick(store.getTick())
          }
        })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, REFETCH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [store])

  useEffect(() => {
    const el = boxRef.current
    if (el === null) return
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const graph = api === null ? { nodes: [], links: [] } : toGraphData(api)
  const links = graph.links.filter((l) => !hidden.has(l.kind))

  const toggle = (kind: LinkKind): void => {
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
        {KINDS.map((k) => (
          <button
            key={k}
            className={hidden.has(k) ? 'legend-chip off' : 'legend-chip'}
            aria-pressed={!hidden.has(k)}
            onClick={() => toggle(k)}
          >
            <span className="legend-swatch" style={{ background: LINK_COLORS[k] }} aria-hidden="true" />
            {KIND_LABEL[k]}
          </button>
        ))}
        {asOfTick !== null && (
          <span className="legend-stamp">as of Day {tickToMoment(asOfTick).day} {tickToMoment(asOfTick).time}</span>
        )}
      </div>
      {api !== null && api.links.length === 0 && (
        <p className="society-empty">{EMPTY_COPY.bonds}</p>
      )}
      <ForceGraph2D
        width={dims.w}
        height={dims.h}
        backgroundColor="rgba(0,0,0,0)"
        graphData={{ nodes: graph.nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) }}
        nodeVal={(n) => (n as GraphNode).size}
        nodeLabel={(n) => (n as GraphNode).name}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          // pixel token: integer-snapped square slab with ink ring, ledge, and bevel
          const n = node as GraphNode & { x?: number; y?: number }
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
          if (n.halo) {
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
        nodeColor={(n) => (n as GraphNode).color}
        linkColor={(l) => (l as { color: string }).color}
        linkWidth={(l) => (l as { width: number }).width}
        linkLineDash={() => [4, 3]}
        onNodeClick={(n) => onPick((n as GraphNode).id)}
      />
    </div>
  )
}
