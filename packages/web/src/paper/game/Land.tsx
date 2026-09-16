import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  DiscoveryResponseSchema,
  agentName,
  kindWords,
  structureTitle,
  type DiscoveryRecord,
} from '@sj/shared'
import type { Structure } from '@sj/engine/state'
import { leavesOf, recordSummary, DISCOVERY_REFETCH_MS } from '../../ui/discoveryModel.js'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { useDressed } from '../../ui/bustStyle.js'
import { thingKind, itemCropDetail } from '../../ui/interaction.js'
import { pointPlay } from '../../ui/replayRun.js'
import { BuildingPage } from '../pages/Building.js'
import { momentStamp } from '../stamp.js'
import type { PageProps } from '../pages/types.js'
import { Empty, FeedState, GameIcon, Search } from './shared.js'

const photos = new WeakMap<NonNullable<PageProps['scene']>, Map<string, string>>()
function PlacePhoto({
  structure,
  store,
  scene,
}: {
  structure: Structure
  store: PageProps['store']
  scene: PageProps['scene']
}) {
  const [photo, setPhoto] = useState<{ key: string; url: string | null } | null>(null)
  const dressed = useDressed(store)
  const ref = useRef<HTMLDivElement>(null)
  const assets = useSyncExternalStore(store.subscribe, store.assetsSeq, store.assetsSeq)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const key = `${structure.id}:${structure.kind}:${structure.x}:${structure.y}:${structure.w}:${structure.h}:${structure.facing}:${structure.stage}:${structure.burning}:${Math.floor(structure.progressTicks / 120)}:${assets}:${mode.live ? 'live' : Math.floor(mode.tick / 60)}`
  useEffect(() => {
    if (!scene || !ref.current || !dressed) return
    let frame = 0
    let cancelled = false
    const element = ref.current
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        observer.disconnect()
        frame = requestAnimationFrame(() => {
          if (cancelled) return
          let cache = photos.get(scene)
          if (!cache) {
            cache = new Map()
            photos.set(scene, cache)
          }
          const url = cache.get(key) ?? scene.capturePlace?.(structure.id)
          if (url) {
            if (cache.size >= 100) cache.delete(cache.keys().next().value!)
            cache.set(key, url)
          }
          setPhoto({ key, url: url ?? null })
        })
      },
      { rootMargin: '120px' },
    )
    observer.observe(element)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [scene, key, structure.id, dressed])
  return (
    <div className="sj-place-photo" ref={ref}>
      {photo?.key === key && photo.url ? (
        <img src={photo.url} alt={`${structureTitle(structure)} in the town`} />
      ) : (
        <span>
          <GameIcon kind="land" />
          {photo?.key === key ? 'Town view unavailable' : 'Opening the town view…'}
        </span>
      )}
    </div>
  )
}
export function GameLand(props: PageProps) {
  return props.tab === 'Discoveries' || props.tab === 'Things' ? (
    <Discoveries {...props} />
  ) : (
    <Places {...props} />
  )
}
function Places(props: PageProps) {
  const { store, onSubject } = props
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  if (!state) return <p role="status">Finding the town’s places…</p>
  const all = Object.values(state.structures)
  const shown = all.filter(
    (s) =>
      (filter === 'lamps' ? s.kind === 'lamp_post' : s.kind !== 'lamp_post') &&
      (filter !== 'homes' || s.kind === 'house') &&
      (filter !== 'building' || s.stage !== 'complete') &&
      `${structureTitle(s)} ${kindWords(s.kind)} ${s.owner ? agentName(state.agents, s.owner) : 'Shared'}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  return (
    <>
      <div className="sj-dispatch">
        <GameIcon kind="land" />
        <div>
          <h3>Places with a story</h3>
          <p>Explore the buildings and corners of your town.</p>
        </div>
      </div>
      <Search value={search} onChange={setSearch} placeholder="Find a place or its owner…" />
      <div className="sj-tools">
        <label>
          Show{' '}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Town places</option>
            <option value="homes">Homes</option>
            <option value="building">Under construction</option>
            <option value="lamps">Lamps</option>
          </select>
        </label>
        <span>{shown.length} places</span>
      </div>
      <div className="sj-places">
        {shown.map((s) => (
          <button
            type="button"
            className="sj-place"
            key={s.id}
            onClick={() => onSubject({ kind: 'structure', id: s.id, name: structureTitle(s) })}
          >
            <PlacePhoto structure={s} scene={props.scene} store={store} />
            <span className="sj-place-copy">
              <span className="sj-meta">
                {s.stage === 'complete' ? kindWords(s.kind) : 'Under construction'} ·{' '}
                {s.owner ? `${agentName(state.agents, s.owner)}’s` : 'Shared place'}
              </span>
              <strong>{structureTitle(s)}</strong>
              <span>
                {s.w} × {s.h} tiles · Condition {Math.round((s.hp / Math.max(1, s.maxHp)) * 100)}%
              </span>
              <span className="sj-link">Explore this place →</span>
            </span>
          </button>
        ))}
      </div>
      {!shown.length && (
        <Empty icon="land" title="No places match">
          Try another name or choose a different kind of place.
        </Empty>
      )}
    </>
  )
}
const parseDiscoveries = (b: unknown): DiscoveryRecord[] | null => {
  const p = DiscoveryResponseSchema.safeParse(b)
  return p.success ? p.data.discoveries : null
}
function Discoveries({ store, thing, onPlay }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const assets = useSyncExternalStore(store.subscribe, store.assetRecords, store.assetRecords)
  const endpoint = useEndpointFor('/api/discoveries', parseDiscoveries, DISCOVERY_REFETCH_MS)
  const read = useFeed(endpoint)
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<{ thing: PageProps['thing']; seq: number } | null>(
    null,
  )
  const selected = selection?.thing === thing ? selection.seq : null
  const leaves = leavesOf(
    (read.data ?? []).filter((r) => r.tick <= (state?.tick ?? 0)),
    assets,
  )
  const clicked = thing ? thingKind(state, thing) : null
  const made = leaves.find((l) => l.record.makes.includes(clicked ?? ''))
  const leaf =
    leaves.find((l) => l.record.seq === selected) ?? (selected === null ? made : undefined)
  if (leaf)
    return (
      <>
        <button type="button" className="sj-back" onClick={() => setSelection({ thing, seq: -1 })}>
          ← All discoveries
        </button>
        <header className="sj-event-head">
          <GameIcon kind="compass" />
          <div>
            <span className="sj-meta">{leaf.when}</span>
            <h3>{leaf.headline}</h3>
          </div>
        </header>
        {leaf.assetId && (
          <img
            className="sj-discovery-art"
            src={`/assets/${leaf.assetId}.png`}
            alt={leaf.headline}
          />
        )}
        <h3 className="sj-heading">What they were trying to do</h3>
        <p className="sj-prose">{leaf.record.intent}</p>
        <p>Discovered by {leaf.record.by}.</p>
        <h3 className="sj-heading">What it makes possible</h3>
        <ul>
          {leaf.record.makes.map((k) => (
            <li key={k}>{kindWords(k)}</li>
          ))}
        </ul>
        <button
          type="button"
          className="sj-primary"
          onClick={() =>
            onPlay(pointPlay(leaf.record.tick, store.liveEdge(), leaf.headline, [leaf.record.byId]))
          }
        >
          <GameIcon kind="compass" />
          Watch the discovery →
        </button>
      </>
    )
  const shown = leaves.filter((l) =>
    `${l.headline} ${l.record.by} ${l.record.makes.join(' ')}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )
  return (
    <>
      <div className="sj-dispatch">
        <GameIcon kind="compass" />
        <div>
          <h3>Little ideas. New possibilities.</h3>
          <p>
            {leaves.length
              ? recordSummary(leaves, state?.tick ?? 0)
              : 'A field guide to what the people work out for themselves.'}
          </p>
        </div>
      </div>
      {thing && !made && <p>{itemCropDetail(state, thing)}</p>}
      <Search value={search} onChange={setSearch} placeholder="Find an idea, maker or material…" />
      <FeedState read={read} retry={endpoint.retry} />
      <div className="sj-discoveries">
        {shown.map((l) => (
          <button
            className="sj-discovery"
            type="button"
            key={l.record.seq}
            onClick={() => setSelection({ thing, seq: l.record.seq })}
          >
            <span className="sj-discovery-icon">
              {l.assetId ? (
                <img src={`/assets/${l.assetId}.png`} alt="" />
              ) : (
                <GameIcon kind="compass" />
              )}
            </span>
            <span>
              <span className="sj-meta">
                {l.when} · {l.record.by}
              </span>
              <strong>{l.headline}</strong>
              <span>{l.record.makes.map(kindWords).join(' · ')}</span>
              <span className="sj-link">Open field note →</span>
            </span>
          </button>
        ))}
      </div>
      {read.loaded && !read.failed && !shown.length && (
        <Empty icon="compass" title={search ? 'No matching discoveries' : 'Curiosity starts small'}>
          {search
            ? 'Try a maker’s name or a different material.'
            : 'New recipes, tools and ways of building will appear here when someone discovers them.'}
        </Empty>
      )}
      <p className="sj-footnote">
        These are the town’s discoveries. Opening a page does not unlock anything for its people.
      </p>
    </>
  )
}
export function GameBuilding(props: PageProps) {
  const state = useSyncExternalStore(
    props.store.subscribe,
    props.store.getState,
    props.store.getState,
  )
  const mode = useSyncExternalStore(props.store.subscribe, props.store.getMode, props.store.getMode)
  const s = state?.structures[props.subject?.id ?? '']
  if (!s || !state)
    return (
      <Empty icon="land" title="Nothing stands here">
        This place is not in the town at this moment.
      </Empty>
    )
  return (
    <>
      <button type="button" className="sj-back" onClick={() => props.onBrowse?.('found')}>
        ← All town places
      </button>
      <PlacePhoto structure={s} store={props.store} scene={props.scene} />
      <h3 className="sj-place-title">{structureTitle(s)}</h3>
      <p className="sj-meta">
        {kindWords(s.kind)} · {s.w} × {s.h} tiles ·{' '}
        {s.stage === 'complete' ? 'Complete' : 'Under construction'}
      </p>
      <div className="sj-facts">
        <div>
          <span>Belongs to</span>
          <strong>{s.owner ? agentName(state.agents, s.owner) : 'Shared by the town'}</strong>
        </div>
        <div>
          <span>Condition</span>
          <strong>{Math.round((s.hp / Math.max(1, s.maxHp)) * 100)}%</strong>
        </div>
        <div>
          <span>Built by</span>
          <strong>
            {s.builtBy ? agentName(state.agents, s.builtBy) : 'Part of the founding town'}
          </strong>
        </div>
      </div>
      {props.tab === 'Inside' ? (
        <BuildingPage {...props} />
      ) : !mode.live ? (
        <p className="sj-footnote">
          {s.plannedTick !== undefined
            ? `Planned ${momentStamp(s.plannedTick)}. ${s.stage === 'complete' ? 'Standing at this moment.' : 'Still being built at this moment.'}`
            : 'This place was here when the town began.'}
        </p>
      ) : s.plannedTick !== undefined ? (
        <BuildingPage {...props} tab="Provenance" />
      ) : (
        <p className="sj-footnote">
          This place was here when the town began. It has no construction entry in the chronicle.
        </p>
      )}
    </>
  )
}
