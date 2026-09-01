import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { tickToMoment, type BondsResponse } from '@sj/shared'
import type { WorldStore } from '../../state/worldStore.js'
import type { Subject } from '../../stage/index.js'
import { TEXT_MIN_PX } from '../../textFloor.js'
import { LegendChip } from '../../ui/LegendChip.js'
import { BondDetail, FadedBond } from './BondDetail.js'
import { EMPTY_LINEAGE, type BondNode, type PeopleIndex } from '../../ui/bondModel2.js'
import {
  keyOpensBy,
  relationLegend,
  rememberKey,
  toRelationGraph,
  type LegendRow,
  type RelationLink,
} from '../../ui/relationGraph.js'
import {
  EMPTY_SOCIETY,
  GONE_RING,
  INSTITUTION_RING,
  halosOf,
  institutionLegend,
  societyFrom,
  trafficGraph,
  trafficLegend,
  type Halo,
} from '../../ui/societyGraph.js'
import { EMPTY_DISPATCHES } from '../../ui/dispatches.js'
import { busiestPerson, orbitOf } from '../../ui/bondOrbit.js'
import { levelMatrix } from '../../ui/bondMatrix.js'
import { BondOrbit, EmptyOrbit } from './BondOrbit.js'
import { LevelMatrixTable } from './LevelMatrix.js'
import { bondsFeed, dispatchesFeed, lineageFeed } from '../../ui/feeds.js'
import { OutOfReach } from '../../ui/OutOfReach.js'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { EMPTY_COPY } from '../../ui/townStats.js'

/** Views, not layers on one picture: how close people are and what has passed between them are
 *  different questions. */
export const SOCIETY_VIEWS = ['ties', 'traffic'] as const
export type SocietyView = (typeof SOCIETY_VIEWS)[number]
export const SOCIETY_VIEW_LABEL: Record<SocietyView, string> = {
  ties: 'How close',
  traffic: 'What passed',
}
/** The fold behind `/api/society` changes about once a tick; the picture is history either way. */
const SOCIETY_REFETCH_MS = 30_000

const EMPTY_API: BondsResponse = { bonds: [], asOfTick: 0 }
/** How far out the first institution ring sits, and how far apart the rings are — clear of the
 *  4px ring a person who is no longer living already wears. */
const HALO_STEP = 4
const HALO_FIRST = 8
/** Doubled from 1.5/3: a hairline over a night ground crossing a slab is not a connection a
 *  viewer can follow. */
const LINK_WIDTH: Readonly<Record<1 | 2, number>> = { 1: 3, 2: 5 }
/** The deep casing every edge is drawn on, so the colour is never read against the ground. */
const LINK_CASING = 1.5
const LINK_CASING_COLOR = '#241F2B'
/** Shared, because these run once per link per node per FRAME and a fresh array each time is
 *  tens of thousands a second for a value that never changes. */
const NO_DASH: number[] = []
const DASH_SCALE = 2
const DOUBLED_DASH = new WeakMap<readonly number[], number[]>()
/** A ring's dash is drawn at its own size, so it gets its own cache rather than the doubled one. */
const RING_DASH = new WeakMap<readonly number[], number[]>()
const drawnRingDash = (dash: readonly number[]): number[] => {
  let out = RING_DASH.get(dash)
  if (out === undefined) {
    out = [...dash]
    RING_DASH.set(dash, out)
  }
  return out
}
const drawnDash = (dash: readonly number[] | null): number[] => {
  if (dash === null) return NO_DASH
  let out = DOUBLED_DASH.get(dash)
  if (out === undefined) {
    out = dash.map((d) => d * DASH_SCALE)
    DOUBLED_DASH.set(dash, out)
  }
  return out
}
const NO_HALO: Halo = { kinds: [], names: [] }

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

/** A name over the graph, one step up from the 12px floor, drawn on a ground of its own. */
const NAME_PX = TEXT_MIN_PX + 1

export function BondsGraph({
  store,
  onSubject,
}: {
  store: WorldStore
  onSubject: (subject: Subject) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const bonds = useFeed(bondsFeed)
  const api = bonds.data
  const lineage = useFeed(lineageFeed).data ?? EMPTY_LINEAGE
  const paper = useFeed(dispatchesFeed).data ?? EMPTY_DISPATCHES
  const halos = useMemo(() => halosOf(paper.institutions), [paper.institutions])
  const haloKinds = useMemo(() => institutionLegend(halos), [halos])
  const [view, setView] = useState<SocietyView>('ties')
  // Not fetched until somebody asks for it: `null` is the endpoint layer's own "do not read".
  const trafficRead = useEndpointFor(
    view === 'traffic' ? '/api/society' : null,
    societyFrom,
    SOCIETY_REFETCH_MS,
  )
  const traffic = useFeed(trafficRead)
  const wireDown = view === 'ties' ? bonds.failed : traffic.failed
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [keyOpen, setKeyOpen] = useState(() => keyOpensBy(sessionStorage))
  const [selected, setSelected] = useState<RelationLink | null>(null)
  // Whose orbit is open below the town graph. Null until somebody picks one, and then it is
  // the person the town has the most to say about.
  const [picked, setPicked] = useState<string | null>(null)
  // The feed refetches every 30s, so the open panel's own tie can leave it mid-read.
  const openBond = useMemo(() => api?.bonds.find((b) => b.id === selected?.id), [api, selected])
  const closeDetail = (): void => {
    setSelected(null)
  }
  const boxRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const [dims, setDims] = useState({ w: 480, h: 320 })

  // Edge length is the level, and it is not a component prop: it lives on the d3 link force, so
  // it is set on the instance once the graph exists.
  useEffect(() => {
    const link = fgRef.current?.d3Force('link') as
      | { distance: (f: (l: unknown) => number) => void }
      | undefined
    link?.distance((l: unknown) => (l as Drawn).distance)
  }, [])

  // Measure the canvas's own cell, never the block around it: force-graph sizes the canvas from
  // `dims`, so a canvas that can grow its container measures itself bigger every frame (7 946px).
  useEffect(() => {
    const el = boxRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  // A fold lands every tick and remakes `state`; keying on who is alive and what they are called
  // is what stops the force layout being re-seeded from scratch every tick.
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

  const ties = useMemo(
    () => toRelationGraph(api ?? EMPTY_API, lineage, people, api?.asOfTick ?? 0),
    [api, lineage, people],
  )
  const passed = useMemo(
    () => trafficGraph(traffic.data ?? EMPTY_SOCIETY, people),
    [traffic.data, people],
  )
  const graph = view === 'ties' ? ties : passed
  const asOf = api?.asOfTick ?? 0
  const centreId = useMemo(
    () => (picked !== null && picked in people ? picked : busiestPerson(people, api ?? EMPTY_API)),
    [picked, people, api],
  )
  const orbit = useMemo(
    () => (centreId === null ? null : orbitOf(centreId, api ?? EMPTY_API, lineage, people, asOf)),
    [centreId, api, lineage, people, asOf],
  )
  const matrix = useMemo(
    () => levelMatrix(api ?? EMPTY_API, lineage, people, asOf),
    [api, lineage, people, asOf],
  )
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

  // The simulation writes x/y onto these very objects, so they are handed over uncloned: a
  // clone would discard the layout on every render.
  const graphData = useMemo(() => ({ nodes: graph.nodes, links }), [graph, links])

  // force-graph reads every one of these once a frame, so a fresh closure a tick is a prop
  // diff a tick over a picture that has not changed.
  const nodeVal = useCallback((n: object) => (n as BondNode).size, [])
  const nodeColor = useCallback((n: object) => (n as BondNode).color, [])
  const nodeLabel = useCallback(
    (n: object) => {
      const node = n as BondNode
      const halo = halos.get(node.id)
      return halo === undefined ? node.name : `${node.name} — ${halo.names.join(', ')}`
    },
    [halos],
  )
  const linkColor = useCallback((l: object) => (l as Drawn).color, [])
  const linkWidth = useCallback((l: object) => LINK_WIDTH[(l as Drawn).strokeCount], [])
  const linkLineDash = useCallback((l: object) => (l as Drawn).dash as number[] | null, [])
  const linkLabel = useCallback((l: object) => (l as Drawn).words, [])
  // ★ THE COMPLAINT: "really hard to see what the connections are". A 1.5px stone line on a
  // night ground, crossing a slab, is a line nobody can follow. Every edge is drawn twice —
  // a deep casing, then the colour on it — which is the same law every mark over the town
  // follows: bring your own ground.
  const drawLink = useCallback((link: object, ctx: CanvasRenderingContext2D) => {
    // Optional on purpose: force-graph hands over the raw id until the simulation resolves it.
    const l = link as Drawn & { source?: PositionedNode; target?: PositionedNode }
    const [a, b] = [l.source, l.target]
    if (a?.x === undefined || a.y === undefined || b?.x === undefined || b.y === undefined) return
    const width = LINK_WIDTH[l.strokeCount]
    ctx.save()
    ctx.lineCap = 'butt'
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.setLineDash(pass === 0 ? NO_DASH : drawnDash(l.dash))
      ctx.lineWidth = pass === 0 ? width + LINK_CASING * 2 : width
      ctx.strokeStyle = pass === 0 ? LINK_CASING_COLOR : l.color
      ctx.stroke()
    }
    ctx.restore()
  }, [])
  const nodeMode = useCallback(() => 'replace' as const, [])
  const onLinkClick = useCallback(
    (l: object) => {
      // Only a tie has a bond behind it to open; a traffic line IS its own whole answer.
      if (view === 'ties') setSelected(l as unknown as RelationLink)
    },
    [view],
  )
  // ★ A node opens the ORBIT below, not the person's page: the graph's job is to hand the
  // reader a person, and the orbit is what answers "who is this one to everybody else".
  const onNodeClick = useCallback((n: object) => {
    setPicked((n as BondNode).id)
  }, [])
  // The canvas mounts nothing tabbable, so this list is the keyboard's only path in. Memoised:
  // the component re-renders on every world tick.
  const roll = useMemo(
    () => (
      <ul className="stage-sr" aria-label="Everyone in the graph. Choose one to open their orbit.">
        {graph.nodes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                onNodeClick(n)
              }}
            >
              {nodeLabel(n)}
            </button>
          </li>
        ))}
      </ul>
    ),
    [graph.nodes, nodeLabel, onNodeClick],
  )

  const drawNode = useCallback(
    (node: object, ctx: CanvasRenderingContext2D) => {
      // The name is not painted here: force-graph runs this once per node in array order, so a
      // later slab would bury an earlier neighbour's name. See onRenderFramePost.
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
        ctx.strokeStyle = GONE_RING
        ctx.lineWidth = 2
        ctx.setLineDash(NO_DASH)
        ctx.strokeRect(x - HALO_STEP, y - HALO_STEP, side + HALO_STEP * 2, side + HALO_STEP * 2)
      }
      const halo = halos.get(n.id) ?? NO_HALO
      halo.kinds.forEach((kind, i) => {
        const out = HALO_FIRST + i * HALO_STEP
        const ring = INSTITUTION_RING[kind]
        ctx.strokeStyle = ring.color
        ctx.lineWidth = 2
        ctx.setLineDash(ring.dash === null ? NO_DASH : drawnRingDash(ring.dash))
        ctx.strokeRect(x - out, y - out, side + out * 2, side + out * 2)
      })
      ctx.setLineDash(NO_DASH)
    },
    [halos],
  )
  const drawNames = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      // Every slab is down by now, so no name can be buried by a neighbour drawn later.
      const fontSize = Math.max(NAME_PX / globalScale, 4)
      ctx.imageSmoothingEnabled = false
      ctx.font = `${fontSize}px Silkscreen, monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2, fontSize / 3)
      ctx.strokeStyle = '#241F2B'
      ctx.fillStyle = '#FFF6E9'
      const nodes: PositionedNode[] = graphData.nodes
      for (const n of nodes) {
        if (n.x === undefined || n.y === undefined) continue
        const side = slabSide(n)
        const lx = Math.round(n.x)
        const ly = Math.round(n.y) - Math.round(side / 2) + side + 4
        // Ink on EVERY side, not one corner, or the edge a name crosses eats a stroke of it —
        // and drawn as one round stroke rather than four offset fills, because this runs per
        // node per frame.
        ctx.strokeText(n.name, lx, ly)
        ctx.fillText(n.name, lx, ly)
      }
    },
    [graphData],
  )

  const toggle = (k: string): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  return (
    // ★ A VERTICAL SHEET, never two pictures crammed side by side: the whole town first, then
    // one person's orbit, then the grid every pair has an address in.
    <div className="bonds-sheet">
      <section className="bonds-section">
        <h4 className="feed-head">Everyone, and who they are to each other</h4>
        <div className="bonds-graph">
          {/* Toggles, not a tablist: the paper's own tab bar owns that pattern and its arrow
              keys, and a second tablist nested in its panel would be one the keyboard cannot
              walk. */}
          <div className="bonds-views" role="group" aria-label="What the picture shows">
            {SOCIETY_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={v === view}
                className={v === view ? 'feed-tab active' : 'feed-tab'}
                onClick={() => {
                  setView(v)
                  setHidden(new Set())
                }}
              >
                {SOCIETY_VIEW_LABEL[v]}
              </button>
            ))}
            <button
              type="button"
              className="key-summary"
              aria-expanded={keyOpen}
              aria-controls="bonds-key"
              onClick={() => {
                setKeyOpen(!keyOpen)
                rememberKey(sessionStorage, !keyOpen)
              }}
            >
              {keyOpen ? 'Hide the key' : 'How to read this'}
              {hidden.size > 0 && <span className="key-filtered">{hidden.size} hidden</span>}
            </button>
          </div>
          {keyOpen && (
            <div id="bonds-key" className="bonds-legend" role="group" aria-label="How to read this">
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
              {haloKinds.length > 0 && (
                <div className="legend-axis" data-axis="formed">
                  <span className="legend-axis-name">What they formed</span>
                  {haloKinds.map((kind) => (
                    <span className="legend-halo" key={kind}>
                      {/* a ring, drawn at the size the graph draws it, so a dotted one is not a
                          solid one at swatch scale */}
                      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
                        <rect x="4" y="4" width="14" height="14" fill="var(--night)" />
                        <rect
                          x="2"
                          y="2"
                          width="18"
                          height="18"
                          fill="none"
                          stroke={INSTITUTION_RING[kind].color}
                          strokeWidth="2"
                          strokeDasharray={INSTITUTION_RING[kind].dash?.join(' ')}
                        />
                      </svg>
                      <span className="legend-word">{INSTITUTION_RING[kind].words}</span>
                    </span>
                  ))}
                </div>
              )}
              {api !== null && (
                <span className="legend-stamp">
                  as of Day {tickToMoment(api.asOfTick).day} {tickToMoment(api.asOfTick).time}
                </span>
              )}
            </div>
          )}

          {(view === 'ties' ? api : traffic.data) === null ? (
            // A field of unconnected people is what BOTH a tieless town and an unanswered fetch
            // look like, so the wait — and the refusal — say which.
            wireDown ? (
              <OutOfReach onRetry={view === 'ties' ? bondsFeed.retry : trafficRead.retry} />
            ) : (
              <p className="feed-empty" aria-busy="true">
                Reading the town’s ties…
              </p>
            )
          ) : graph.links.length === 0 && graph.nodes.length > 0 ? (
            <p className="feed-empty">{view === 'ties' ? EMPTY_COPY.bonds : EMPTY_COPY.traffic}</p>
          ) : null}

          {view === 'ties' &&
            selected !== null &&
            api !== null &&
            (openBond ? (
              <BondDetail
                bond={openBond}
                people={people}
                type={selected.type}
                level={selected.level}
                arc={selected.arc}
                words={selected.words}
                onClose={closeDetail}
              />
            ) : (
              <FadedBond onClose={closeDetail} />
            ))}

          {roll}

          <div className="bonds-canvas" ref={boxRef}>
            <ForceGraph2D
              width={dims.w}
              height={dims.h}
              backgroundColor="rgba(0,0,0,0)"
              graphData={graphData}
              nodeVal={nodeVal}
              nodeLabel={nodeLabel}
              ref={fgRef}
              nodeCanvasObjectMode={nodeMode}
              nodeCanvasObject={drawNode}
              linkCanvasObject={drawLink}
              onRenderFramePost={drawNames}
              nodeColor={nodeColor}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkLineDash={linkLineDash}
              linkLabel={linkLabel}
              onLinkClick={onLinkClick}
              onNodeClick={onNodeClick}
            />
          </div>
          <p className="bonds-hint">Choose anyone above to open their orbit.</p>
        </div>
      </section>

      <section className="bonds-section">
        <div className="bonds-section-head">
          <h4 className="feed-head">
            {orbit === null ? 'One person’s orbit' : `${orbit.name}, and everyone`}
          </h4>
          {orbit !== null && (
            <button
              type="button"
              className="feed-tab"
              onClick={() => {
                onSubject({ id: orbit.id, kind: 'agent', name: orbit.name })
              }}
            >
              Open {orbit.name}’s story
            </button>
          )}
        </div>
        {orbit === null ? (
          bonds.failed ? (
            <OutOfReach onRetry={bondsFeed.retry} />
          ) : (
            <p className="feed-empty" aria-busy={!bonds.loaded}>
              {EMPTY_COPY.bonds}
            </p>
          )
        ) : orbit.ties.length === 0 ? (
          <EmptyOrbit name={orbit.name} />
        ) : (
          <BondOrbit orbit={orbit} onCentre={setPicked} />
        )}
      </section>

      <section className="bonds-section">
        <h4 className="feed-head">Every pair has one address</h4>
        {matrix.rows.length === 0 ? (
          <p className="feed-empty">{EMPTY_COPY.bonds}</p>
        ) : (
          <LevelMatrixTable matrix={matrix} centreId={centreId} onCentre={setPicked} />
        )}
      </section>
    </div>
  )
}
