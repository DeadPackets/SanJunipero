import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { tickToMoment, type BondsResponse } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { TEXT_MIN_PX } from '../textFloor.js'
import { BondDetailPanel } from './BondDetailPanel.js'
import { LegendChip } from './LegendChip.js'
import { BondsVeil } from './StageVeil.js'
import { EMPTY_LINEAGE } from './bondModel2.js'
import {
  toRelationGraph,
  relationLegend,
  type LegendRow,
  type RelationLink,
} from './relationGraph.js'
import type { BondNode, PeopleIndex } from './bondModel2.js'
import { EMPTY_SOCIETY, societyFrom, trafficGraph, trafficLegend } from './societyGraph.js'
import { bondsFeed, lineageFeed } from './feeds.js'
import { useFeed, usePolled } from './useEndpoint.js'
import { EMPTY_COPY } from './townStats.js'

/** Two readings of one town: how close people are, and what has actually passed between them.
 *  They answer different questions, so they are views rather than layers on one picture. */
export const SOCIETY_VIEWS = ['ties', 'traffic'] as const
export type SocietyView = (typeof SOCIETY_VIEWS)[number]
export const SOCIETY_VIEW_LABEL: Record<SocietyView, string> = {
  ties: 'How close',
  traffic: 'What passed',
}
/** The fold behind `/api/society` changes about once a tick; the picture is history either way. */
const SOCIETY_REFETCH_MS = 30_000

const HALO_COLOR = '#F4E289'
const EMPTY_API: BondsResponse = { bonds: [], asOfTick: 0 }

/** What the canvas needs of a line, whichever view drew it. */
type Drawn = Pick<RelationLink, 'distance' | 'dash' | 'strokeCount' | 'color' | 'words'>

const AXIS_NAME: Readonly<Record<LegendRow['axis'], string>> = {
  level: 'How close',
  type: 'Family',
  arc: 'Which way',
  kind: 'What passed',
}

/** A node once the simulation has placed it. `x`/`y` are absent until the first tick. */
type PositionedNode = BondNode & { x?: number; y?: number }

const slabSide = (n: BondNode): number => Math.max(14, Math.round(Math.sqrt(n.size) * 5))

export function SocietyLens({
  store,
  onPick,
}: {
  store: WorldStore
  onPick: (agentId: string) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const api = useFeed(bondsFeed).data
  const lineage = useFeed(lineageFeed).data ?? EMPTY_LINEAGE
  const [view, setView] = useState<SocietyView>('ties')
  // Not fetched until somebody asks for it: `null` is the endpoint layer's own "do not read".
  const traffic = usePolled(
    view === 'traffic' ? '/api/society' : null,
    societyFrom,
    SOCIETY_REFETCH_MS,
  )
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
      | { distance: (f: (l: unknown) => number) => void }
      | undefined
    link?.distance((l: unknown) => (l as Drawn).distance)
  }, [])

  useEffect(() => {
    const el = boxRef.current
    if (el === null) return
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  // Names come from the world the viewer already holds — the bonds endpoint carries ties, not
  // people, so a rename can never disagree with the map. A fold lands every tick and remakes
  // `state`, but the graph only cares who is alive and what they are called: keying on that
  // signature is what stops the force layout being re-seeded from scratch every tick.
  const nameSig = useMemo(() => {
    const out: string[] = []
    for (const a of Object.values(state?.agents ?? {})) if (a.alive) out.push(`${a.id}\t${a.name}`)
    return out.sort().join('\n')
  }, [state])

  const people: PeopleIndex = useMemo(() => {
    const out: Record<string, { name: string; alive: boolean }> = {}
    for (const line of nameSig === '' ? [] : nameSig.split('\n')) {
      const at = line.indexOf('\t')
      out[line.slice(0, at)] = { name: line.slice(at + 1), alive: true }
    }
    return out
  }, [nameSig])

  // The warmth an edge is drawn at reads the tick the BONDS answer was taken at, not the live
  // clock, so the picture and the `legend-stamp` beside it name the same moment.
  const ties = useMemo(
    () => toRelationGraph(api ?? EMPTY_API, lineage, people, api?.asOfTick ?? 0),
    [api, lineage, people],
  )
  const passed = useMemo(
    () => trafficGraph(traffic.data ?? EMPTY_SOCIETY, people),
    [traffic.data, people],
  )
  const graph = view === 'ties' ? ties : passed
  const legend = useMemo(() => (view === 'ties' ? relationLegend() : trafficLegend()), [view])
  const axes = view === 'ties' ? (['level', 'type', 'arc'] as const) : (['kind'] as const)
  const key = (r: LegendRow): string => `${r.axis}:${r.key}`
  const links = useMemo(
    () =>
      view === 'ties'
        ? ties.links.filter(
            (l) =>
              !hidden.has(`level:${l.level}`) &&
              !hidden.has(`type:${l.type}`) &&
              !hidden.has(`arc:${l.arc.direction}`),
          )
        : passed.links.filter((l) => !hidden.has(`kind:${l.kind}`)),
    [view, ties, passed, hidden],
  )

  // The simulation writes x/y onto these very objects, so they are handed over uncloned and
  // held by ref: a clone would discard the layout on every render, and the label pass below
  // needs the positions force-graph is mutating.
  const graphData = useMemo(() => ({ nodes: graph.nodes, links }), [graph, links])

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
      <div className="society-views" role="tablist" aria-label="What the picture shows">
        {SOCIETY_VIEWS.map((v) => (
          <button
            key={v}
            role="tab"
            id={`society-tab-${v}`}
            aria-selected={v === view}
            tabIndex={v === view ? 0 : -1}
            className={v === view ? 'feed-tab active' : 'feed-tab'}
            onClick={() => {
              setView(v)
              setHidden(new Set())
            }}
          >
            {SOCIETY_VIEW_LABEL[v]}
          </button>
        ))}
      </div>
      <div className="society-key" data-open={keyOpen ? 'yes' : 'no'}>
        <button
          type="button"
          className="key-summary"
          aria-expanded={keyOpen}
          aria-controls="society-key-body"
          onClick={() => {
            setKeyOpen((v) => !v)
          }}
        >
          {keyOpen ? 'Hide the key' : 'How to read this'}
          {hiddenCount > 0 && <span className="key-filtered">{hiddenCount} hidden</span>}
        </button>
        {keyOpen && (
          <div
            id="society-key-body"
            className="society-legend"
            role="group"
            aria-label="How to read this"
          >
            {axes.map((axis) => (
              <div className="legend-axis" key={axis} data-axis={axis}>
                <span className="legend-axis-name">{AXIS_NAME[axis]}</span>
                {legend
                  .filter((r) => r.axis === axis)
                  .map((r) => (
                    <LegendChip
                      key={key(r)}
                      row={r}
                      off={hidden.has(key(r))}
                      onToggle={() => {
                        toggle(key(r))
                      }}
                    />
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
          in which nothing has passed between anyone yet — and a field of unconnected people is
          what BOTH a tieless town and an unanswered fetch look like, so the wait says so. */}
      {(view === 'ties' ? api : traffic.data) === null ? (
        <BondsVeil />
      ) : graph.links.length === 0 && graph.nodes.length > 0 ? (
        <p className="society-empty">{view === 'ties' ? EMPTY_COPY.bonds : EMPTY_COPY.traffic}</p>
      ) : null}

      {view === 'ties' && selected !== null && api !== null && (
        <BondDetailPanel
          bond={api.bonds.find((b) => b.id === selected.id)!}
          people={people}
          type={selected.type}
          level={selected.level}
          arc={selected.arc}
          words={selected.words}
          onClose={() => {
            setSelected(null)
          }}
        />
      )}

      <ForceGraph2D
        width={dims.w}
        height={dims.h}
        backgroundColor="rgba(0,0,0,0)"
        graphData={graphData}
        nodeVal={(n) => (n as BondNode).size}
        nodeLabel={(n) => (n as BondNode).name}
        ref={fgRef}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node, ctx) => {
          // pixel token: integer-snapped square slab with ink ring, ledge, and bevel. The NAME
          // is not painted here: force-graph runs this once per node in array order, so a later
          // slab would bury an earlier neighbour's name. See onRenderFramePost.
          const n = node as PositionedNode
          if (n.x === undefined || n.y === undefined) return
          ctx.imageSmoothingEnabled = false
          const side = slabSide(n)
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
        }}
        onRenderFramePost={(ctx, globalScale) => {
          // Every slab is down by now, so no name can be buried by a neighbour drawn later.
          // ctx is already scaled, so dividing by globalScale pins the label at TEXT_MIN_PX
          // on screen however far the graph is zoomed out.
          const fontSize = Math.max(TEXT_MIN_PX / globalScale, 4)
          ctx.imageSmoothingEnabled = false
          ctx.font = `${fontSize}px Silkscreen, monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          const nodes: PositionedNode[] = graphData.nodes
          for (const n of nodes) {
            if (n.x === undefined || n.y === undefined) continue
            const side = slabSide(n)
            const lx = Math.round(n.x)
            const ly = Math.round(n.y) - Math.round(side / 2) + side + 4
            ctx.fillStyle = '#241F2B'
            ctx.fillText(n.name, lx + 1, ly + 1)
            ctx.fillStyle = '#FFF6E9'
            ctx.fillText(n.name, lx, ly)
          }
        }}
        nodeColor={(n) => (n as BondNode).color}
        linkColor={(l) => (l as Drawn).color}
        linkWidth={(l) => ((l as Drawn).strokeCount === 2 ? 3 : 1.5)}
        linkLineDash={(l) => (l as Drawn).dash as number[] | null}
        linkLabel={(l) => (l as Drawn).words}
        onLinkClick={(l) => {
          // Only a tie has a bond behind it to open; a traffic line IS its own whole answer.
          if (view === 'ties') setSelected(l as unknown as RelationLink)
        }}
        onNodeClick={(n) => {
          onPick((n as BondNode).id)
        }}
      />
    </div>
  )
}
