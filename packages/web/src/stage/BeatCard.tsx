import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  VALENCE,
  WHY_PHRASE,
  agentName,
  type Aim,
  type NameIndex,
  type SceneKind,
  type SceneMove,
  type SimEvent,
  type ThreadRow,
} from '@sj/shared'
import type { TownScene, WorldStore } from '../state/worldStore.js'
import { bustStyle, useDressed, type BustStyle } from '../ui/bustStyle.js'
import { aimsFeed } from '../ui/feeds.js'
import { ladderLine, type LadderLine } from '../ui/sentenceLadder.js'
import { VALENCE_TONE, threadCapsules } from '../ui/threadModel.js'
import { useFeed } from '../ui/useEndpoint.js'
import {
  NO_BOOK,
  NO_ROWS,
  createSceneLedger,
  type SceneBook,
  type SceneRows,
} from './sceneLedger.js'

// Want, try, turn: the three things a room is, every one of them already in the browser's
// memory. Nothing here asks the server for a frame it does not already send.

/** Head and shoulders at the size the story strip uses, so a face is the same face across the
 *  screen. */
export const BEAT_BUST_PX = 26
/** As many busts as the card's own head row holds before it says the rest as a count. */
export const BEAT_BUST_CAP = 4

/** The ten moves as a person would say them. The move is the town's own record of what a line
 *  was doing; `none` is a line doing nothing, and gets no row rather than a made-up one. */
export const MOVE_WORDS: Readonly<Record<SceneMove, string | null>> = {
  press: 'pressing',
  give_way: 'giving way',
  deflect: 'turning it aside',
  tease: 'teasing',
  none: null,
  tell: 'telling it',
  ask: 'asking',
  joke: 'joking',
  agree: 'agreeing',
  shift: 'changing the subject',
}

/** The newest line in a room, as the world recorded it. */
export type Said = { agentId: string; move: SceneMove }
/** One entry per room the town has open. A close drops its entry, so a night's talking does
 *  not leave a key behind for every scene the town ever ran. */
export type MoveBook = Readonly<Record<string, Said>>
export const NO_MOVES: MoveBook = {}

const isMove = (v: unknown): v is SceneMove => typeof v === 'string' && v in MOVE_WORDS

/** The moves off a tick's own events. `scene_line` never reaches `recentEvents`: the chronicle
 *  drops it, which is why this reads the wire and not the log. */
export function readMoves(book: MoveBook, evts: readonly SimEvent[]): MoveBook {
  let next = book
  for (const ev of evts) {
    const p = ev.payload as { id?: unknown; agentId?: unknown; move?: unknown }
    if (typeof p.id !== 'string') continue
    if (ev.type === 'scene_closed') {
      if (!(p.id in next)) continue
      const { [p.id]: _gone, ...rest } = next
      next = rest
      continue
    }
    if (ev.type !== 'scene_line') continue
    if (typeof p.agentId !== 'string' || !isMove(p.move)) continue
    next = { ...next, [p.id]: { agentId: p.agentId, move: p.move } }
  }
  return next
}

/** The story this room belongs to, by the same overlap rule the ribbon lights a capsule with:
 *  a cut whose cast straddles two stories belongs to the wider overlap and to no other. */
export function threadOf(
  threads: readonly ThreadRow[],
  cast: readonly string[],
  now: number,
): ThreadRow | null {
  const lit = threadCapsules(threads, { now, cutCast: cast, ledger: new Map() }).findIndex(
    (c) => c.onScreen,
  )
  return lit < 0 ? null : (threads[lit] ?? null)
}

/** What the room is about, in the order the town can say it: the topic it opened on, then the
 *  first goal anybody in it carries into the day, then the two reasons this story weighs. */
export function wantOf(
  scene: TownScene,
  aims: readonly Aim[],
  thread: ThreadRow | null,
): string | null {
  const topic = scene.topic?.trim() ?? ''
  if (topic !== '') return topic
  for (const id of scene.participants) {
    const goal = aims.find((a) => a.agentId === id)?.goal?.trim() ?? ''
    if (goal !== '') return goal
  }
  if (thread === null) return null
  return thread.terms.map((t) => WHY_PHRASE[t]).join(', ')
}

/** Who is doing what about it, right now. */
export function tryOf(said: Said | undefined, agents: NameIndex | undefined): string | null {
  if (said === undefined) return null
  const word = MOVE_WORDS[said.move]
  return word === null ? null : `${agentName(agents, said.agentId)} is ${word}`
}

export type BeatLabel = 'WANT' | 'TRY' | 'TURN'
export type BeatRow = { label: BeatLabel; text: string }

export type BeatView = {
  kind: SceneKind
  /** the kind in the camera's own caption word, never a title we wrote */
  eyebrow: string
  /** warm, cold or neither, off the town's own table of what a term is worth */
  tone: 'cost' | 'gain' | 'plain'
  /** the town's own sentence for this room, or for the story it belongs to */
  head: LadderLine | null
  rows: readonly BeatRow[]
  chips: SceneRows['chips']
  cast: readonly string[]
  more: number
  /** false once the room has closed: the card keeps its stripe and its busts and drops the rest */
  open: boolean
}

export type BeatArgs = {
  scene: TownScene | null
  agents: NameIndex | undefined
  /** what the talk turned on and what it changed, off the one ledger the page already folds */
  rows: SceneRows
  moves: MoveBook
  aims: readonly Aim[]
  threads: readonly ThreadRow[]
  now: number
}

/** Everything the card draws, and nothing a renderer can get wrong. A row with no source is
 *  left out: there is no placeholder here and no sentence the town did not write. */
export function beatViewOf(args: BeatArgs): BeatView | null {
  const { scene } = args
  if (scene === null) return null
  const thread = threadOf(args.threads, scene.participants, args.now)
  const own = ladderLine(
    { beat: scene.beat, summary: scene.summary },
    args.now,
    new Map<string, number>(),
  )
  const rows: BeatRow[] = []
  const push = (label: BeatLabel, text: string | null): void => {
    if (text !== null && text.trim() !== '') rows.push({ label, text: text.trim() })
  }
  push('WANT', wantOf(scene, args.aims, thread))
  push('TRY', tryOf(args.moves[scene.id], args.agents))
  push('TURN', args.rows.turns[args.rows.turns.length - 1] ?? null)
  return {
    kind: scene.kind,
    eyebrow: WHY_PHRASE[scene.kind],
    tone: VALENCE_TONE[`${VALENCE[scene.kind]}`],
    head: own ?? threadLine(thread, args.now),
    rows,
    chips: args.rows.chips,
    cast: scene.participants.slice(0, BEAT_BUST_CAP),
    more: Math.max(0, scene.participants.length - BEAT_BUST_CAP),
    open: scene.open,
  }
}

/** The story's own prose, for a room that has not written any of its own yet. */
function threadLine(thread: ThreadRow | null, now: number): LadderLine | null {
  if (thread === null) return null
  return ladderLine(
    { beat: thread.beat, summary: thread.summary, proseTick: thread.proseTick },
    now,
    new Map<string, number>(),
  )
}

const NO_AIMS: readonly Aim[] = []
const NO_THREADS: readonly ThreadRow[] = []

/** The live card. The scene it draws is the one the camera is on, so a viewer never reads one
 *  room's want under another room's picture. */
export function BeatCard({ store }: { store: WorldStore }) {
  const scene = useSyncExternalStore(store.subscribe, store.shotScene, store.shotScene)
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const now = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const threads = useSyncExternalStore(store.subscribe, store.threads, store.threads)
  useSyncExternalStore(store.subscribe, store.assetsSeq, store.assetsSeq)
  const dressed = useDressed(store)
  const aims = useFeed(aimsFeed).data?.aims ?? NO_AIMS
  const [book, setBook] = useState<SceneBook>(NO_BOOK)
  const [moves, setMoves] = useState<MoveBook>(NO_MOVES)

  useEffect(() => {
    const ledger = createSceneLedger(store)
    const offBook = ledger.onChange(setBook)
    const offMoves = store.onEvents((evts) => {
      setMoves((was) => readMoves(was, evts))
    })
    return () => {
      offBook()
      ledger.destroy()
      offMoves()
    }
  }, [store])

  const view = beatViewOf({
    scene,
    agents: state?.agents,
    rows: (scene === null ? undefined : book[scene.id]) ?? NO_ROWS,
    moves,
    aims,
    threads: threads?.threads ?? NO_THREADS,
    now,
  })
  if (view === null) return null
  return (
    <BeatCardBody
      view={view}
      bustOf={dressed ? (id) => bustStyle(store.assetRecords(), id, BEAT_BUST_PX) : NO_BUST}
    />
  )
}

const NO_BUST = (): BustStyle | null => null

/** The markup alone, so the card can be driven without a browser: everything above it is an
 *  effect, and an effect wants a DOM the suite does not have. */
export function BeatCardBody({
  view,
  bustOf = NO_BUST,
}: {
  view: BeatView
  bustOf?: (agentId: string) => BustStyle | null
}) {
  return (
    <aside
      className="beat-card at-watch"
      data-tone={view.tone}
      data-open={view.open ? 'on' : 'off'}
    >
      <div className="beat-card-head">
        <span className="beat-card-busts" aria-hidden="true">
          {view.cast.map((id) => {
            const bust = bustOf(id)
            return (
              <span
                className={bust === null ? 'beat-card-bust none' : 'beat-card-bust'}
                key={id}
                style={bust ?? undefined}
              />
            )
          })}
        </span>
        <span className="beat-card-kind">{view.eyebrow}</span>
        {view.more > 0 && <span className="beat-card-more">{`and ${String(view.more)} more`}</span>}
      </div>
      {view.head !== null && (
        <p className="beat-card-line" data-stale={view.head.stale ? 'yes' : undefined}>
          {view.head.text}
        </p>
      )}
      {view.rows.length > 0 && (
        <dl className="beat-card-rows">
          {view.rows.map((row) => (
            <div className="beat-card-row" key={row.label}>
              <dt className="beat-card-label">{row.label}</dt>
              <dd className="beat-card-text">{row.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {view.chips.length > 0 && (
        <ul className="beat-card-chips">
          {view.chips.map((chip, i) => (
            <li className="beat-card-chip" data-tone={chip.tone} key={`${String(i)} ${chip.text}`}>
              {chip.text}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
