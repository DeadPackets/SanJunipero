import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { GameIcon, iconOf } from '../paper/game/shared.js'
import { milestonesFeed } from '../ui/feeds.js'
import { cueFor } from '../ui/stageCue.js'

type Notice = { id: string; title: string; label: string; icon: string; quiet: boolean }
const NEWS = new Set([
  'structure_completed',
  'discovery_made',
  'law_ratified',
  'agent_born',
  'partnership_formed',
  'agent_died',
])

export function Keepsake({
  store,
  onOpen,
}: {
  store: WorldStore
  onOpen: (first: boolean) => void
}) {
  const [queue, setQueue] = useState<Notice[]>([])
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [away, setAway] = useState(() => document.hidden)
  const remaining = useRef(9000)
  const current = queue[0]
  useEffect(() => {
    let baseline: number | null = null
    let firsts: Set<string> | null = null
    const seen = new Set<string>()
    const push = (notice: Notice) => {
      if (seen.has(notice.id)) return
      seen.add(notice.id)
      if (seen.size > 500) seen.delete(seen.values().next().value!)
      setQueue((was) => (was.length < 12 ? [...was, notice] : was))
    }
    const sync = () => {
      if (baseline === null && store.getState()) baseline = store.logSeq()
      if (!store.getMode().live) {
        baseline = store.logSeq()
        setQueue((was) => (was.length ? [] : was))
      }
    }
    const read = () => {
      const rows = milestonesFeed.get().data
      if (!rows) return
      const keys = new Set(rows.map((row) => `${row.kind}:${row.eventSeq}`))
      if (firsts && baseline !== null && store.getMode().live && !document.hidden) {
        for (const row of rows) {
          const key = `${row.kind}:${row.eventSeq}`
          if (firsts.has(key) || row.eventSeq <= baseline) continue
          push({
            id: key,
            title: row.label,
            label: 'A town first',
            icon: iconOf(row.kind),
            quiet: false,
          })
        }
      }
      firsts = keys
    }
    const offStore = store.subscribe(sync)
    const offFirsts = milestonesFeed.subscribe(read)
    const offEvents = store.onEvents((events) => {
      if (!store.getMode().live || document.hidden) return
      for (const ev of events) {
        if (!NEWS.has(ev.type)) continue
        const cue = cueFor(ev, store.getState())
        if (!cue) continue
        push({
          id: `event:${ev.seq}`,
          title: cue.text,
          label: ev.type === 'agent_died' ? 'A life remembered' : 'A town moment',
          icon: iconOf(ev.type),
          quiet: ev.type === 'agent_died',
        })
      }
    })
    const visibility = () => {
      setAway(document.hidden)
      if (document.hidden) setQueue([])
      baseline = store.logSeq()
    }
    document.addEventListener('visibilitychange', visibility)
    sync()
    read()
    return () => {
      offStore()
      offFirsts()
      offEvents()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [store])
  useEffect(() => {
    remaining.current = 9000
  }, [current?.id])
  useEffect(() => {
    if (!current || hover || focus || away) return
    const start = performance.now()
    const timer = setTimeout(() => {
      setQueue((was) => was.slice(1))
    }, remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - start))
    }
  }, [current, hover, focus, away])
  const dismiss = () => {
    setQueue((was) => was.slice(1))
    setHover(false)
    setFocus(false)
  }
  if (!current) return null
  return (
    <section
      key={current.id}
      className="keepsake"
      data-quiet={current.quiet}
      aria-label="Town notice"
      onPointerEnter={() => {
        setHover(true)
      }}
      onPointerLeave={() => {
        setHover(false)
      }}
      onFocus={() => {
        setFocus(true)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false)
      }}
    >
      <div className="keepsake-emblem">
        <GameIcon kind={current.icon} />
        {!current.quiet && <span className="keepsake-orbit" />}
      </div>
      <div className="keepsake-copy">
        <small>{current.label}</small>
        <h2 role="status">{current.title}</h2>
        <button
          type="button"
          onClick={() => {
            onOpen(current.label === 'A town first')
            dismiss()
          }}
        >
          Open Chronicle →
        </button>
      </div>
      <button
        className="keepsake-close"
        type="button"
        aria-label="Dismiss town notice"
        onClick={dismiss}
      >
        ×
      </button>
      {queue.length > 1 && <span className="keepsake-count">+{queue.length - 1} waiting</span>}
      {!current.quiet && (
        <span className="keepsake-sparks" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  '--dx': `${Math.cos((i * Math.PI) / 6) * 82}px`,
                  '--dy': `${Math.sin((i * Math.PI) / 6) * 65}px`,
                  '--spark': ['#e2b75d', '#e68d82', '#96ad72', '#8faec9'][i % 4],
                } as CSSProperties
              }
            />
          ))}
        </span>
      )}
    </section>
  )
}
