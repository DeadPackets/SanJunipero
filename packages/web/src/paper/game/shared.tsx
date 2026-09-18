import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { AgentBody } from '@sj/engine/state'
import { kindWords } from '@sj/shared'
import { resolveAssetId } from '../../render/textures.js'
import { bustStyle, useDressed } from '../../ui/bustStyle.js'
import { localStore } from '../../ui/storage.js'
import type { WorldStore } from '../../state/worldStore.js'
import type { Read } from '../../ui/useEndpoint.js'
import icons from './assets/flat-icons.png'

const ICONS = [
  'folk',
  'chronicle',
  'land',
  'rule',
  'leaf',
  'hammer',
  'fish',
  'bowl',
  'moon',
  'star',
  'medal',
  'people',
  'compass',
  'lamp',
  'note',
  'search',
]
export function GameIcon({ kind, className = '' }: { kind: string; className?: string }) {
  const index = Math.max(0, ICONS.indexOf(kind))
  return (
    <span
      className={`sj-icon ${className}`}
      aria-hidden="true"
      style={{
        backgroundImage: `url(${icons})`,
        backgroundPosition: `${((index % 4) * 100) / 3}% ${(Math.floor(index / 4) * 100) / 3}%`,
      }}
    />
  )
}
export const BOOK_ICON = {
  folk: 'folk',
  chronicle: 'chronicle',
  found: 'land',
  laws: 'rule',
  person: 'folk',
  building: 'land',
}
export function Portrait({
  store,
  id,
  size = 64,
}: {
  store: WorldStore
  id: string
  size?: number
}) {
  const dressed = useDressed(store)
  useSyncExternalStore(store.subscribe, store.assetsSeq, store.assetsSeq)
  const records = store.assetRecords()
  const portrait = dressed ? resolveAssetId(records, 'portrait', id) : null
  const bust = dressed ? bustStyle(records, id, size) : null
  const style: CSSProperties = { width: size, height: size }
  return portrait !== null ? (
    <img className="sj-portrait" style={style} src={`/assets/${portrait}.png`} alt="" />
  ) : (
    <span className="sj-portrait" style={{ ...style, ...bust }} aria-hidden="true">
      {bust === null && <GameIcon kind="folk" />}
    </span>
  )
}
export function skillOf(a: AgentBody): { words: string; icon: string } {
  const best = Object.entries(a.skills)
    .filter(([, xp]) => xp > 0)
    .sort((a, b) => b[1] - a[1])[0]
  if (!best) return { words: 'Finding their path', icon: 'compass' }
  return { words: `${kindWords(best[0])} · ${Math.round(best[1])} XP`, icon: iconOf(best[0]) }
}
export function iconOf(kind: string): string {
  if (kind.includes('fish')) return 'fish'
  if (/build|structure|craft|tool/.test(kind)) return 'hammer'
  if (/harvest|plant|farm|forage|crop|weather/.test(kind)) return 'leaf'
  if (/sleep|rest|night|dream/.test(kind)) return 'moon'
  if (/eat|cook|meal|food/.test(kind)) return 'bowl'
  if (/bond|marri|birth|partner|speak|social|trade|gift/.test(kind)) return 'people'
  if (/law|rule|council/.test(kind)) return 'rule'
  if (/fire|lamp/.test(kind)) return 'lamp'
  return 'note'
}
export function tintOf(id: string): string {
  return ['sage', 'blue', 'gold', 'coral', 'rose'][
    Array.from(id).reduce((n, c) => n + c.charCodeAt(0), 0) % 5
  ]!
}
const listeners = new Set<() => void>()
function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStore()?.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
let notebook = {
  following: readIds('sj.notebook.following'),
  opened: readIds('sj.notebook.opened'),
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const snapshot = () => notebook
function save(key: 'following' | 'opened', ids: string[]) {
  notebook = { ...notebook, [key]: ids }
  try {
    localStore()?.setItem(`sj.notebook.${key}`, JSON.stringify(ids))
  } catch {
    /* Keep the choice for this session when storage is blocked. */
  }
  for (const fn of listeners) fn()
}
export const markOpened = (id: string) => {
  if (!notebook.opened.includes(id)) save('opened', [...notebook.opened, id])
}
const toggleFollowing = (id: string) => {
  save(
    'following',
    notebook.following.includes(id)
      ? notebook.following.filter((v) => v !== id)
      : [...notebook.following, id],
  )
}
export const useNotebook = () => useSyncExternalStore(subscribe, snapshot, snapshot)
export function FollowStar({ id, name }: { id: string; name: string }) {
  const { following } = useNotebook()
  const on = following.includes(id)
  return (
    <button
      className="sj-follow"
      type="button"
      aria-pressed={on}
      aria-label={`${on ? 'Unfollow' : 'Follow'} ${name}`}
      onClick={() => {
        toggleFollowing(id)
      }}
    >
      <GameIcon kind="star" />
    </button>
  )
}
export function Empty({
  icon = 'note',
  title,
  children,
}: {
  icon?: string
  title: string
  children: ReactNode
}) {
  return (
    <div className="sj-empty">
      <GameIcon kind={icon} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}
export function FeedState({ read, retry }: { read: Read<unknown>; retry: () => void }) {
  if (read.failed)
    return (
      <div className="sj-feed-state" role="status">
        This record could not be refreshed.{' '}
        <button type="button" onClick={retry}>
          Try again
        </button>
      </div>
    )
  if (!read.loaded)
    return (
      <p className="sj-feed-state" role="status">
        Opening the town’s record…
      </p>
    )
  return null
}
export function Need({ label, value, icon }: { label: string; value: number; icon: string }) {
  const v = Math.round(Math.max(0, Math.min(100, value)))
  return (
    <div className="sj-need" data-low={v < 30}>
      <span>
        <GameIcon kind={icon} />
        {label}
      </span>
      <strong>
        {v}
        <small>/100</small>
      </strong>
      <meter min={0} max={100} value={v} aria-label={label} />
    </div>
  )
}
export function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (s: string) => void
  placeholder: string
}) {
  return (
    <label className="sj-search">
      <GameIcon kind="search" />
      <input
        type="search"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  )
}
export function useOpened(id: string | null) {
  useEffect(() => {
    if (id !== null) markOpened(id)
  }, [id])
}
