import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MINUTES_PER_DAY } from '@sj/shared'
import { GameIcon } from '../paper/game/shared.js'
import { stamp } from '../paper/stamp.js'
import type { Mark } from '../ui/timelineMarks.js'

const categories: Record<Mark['kind'], { icon: string; label: string; tint: string }> = {
  death: { icon: 'moon', label: 'Remembering', tint: 'chapter' },
  birth: { icon: 'leaf', label: 'A new life', tint: 'people' },
  built: { icon: 'land', label: 'Land', tint: 'home' },
  first: { icon: 'star', label: 'Firsts', tint: 'first' },
  chapter: { icon: 'chronicle', label: 'Chronicle', tint: 'chapter' },
  changed: { icon: 'folk', label: 'Folk', tint: 'people' },
  quarrel: { icon: 'people', label: 'Folk', tint: 'people' },
  joined: { icon: 'people', label: 'Arrival', tint: 'people' },
  left: { icon: 'compass', label: 'Departure', tint: 'people' },
  discovery: { icon: 'leaf', label: 'Discovery', tint: 'home' },
}

export function AlmanacMoments({
  marks,
  onWatch,
}: {
  marks: readonly Mark[]
  onWatch: (tick: number) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const id = useId()
  const [width, setWidth] = useState(0)
  const [selection, setSelection] = useState<{
    openerKey: string
    group: readonly Mark[]
    groups: Mark[][]
    all: readonly Mark[]
    moment: Mark | null
    left: number
    top: number
  } | null>(null)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth)
      setSelection(null)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])
  const groups = useMemo(() => {
    const result: Mark[][] = []
    for (const mark of marks) {
      const previous = result[result.length - 1]
      if (
        previous &&
        ((mark.tick - previous[previous.length - 1]!.tick) / MINUTES_PER_DAY) * width < 48
      )
        previous.push(mark)
      else result.push([mark])
    }
    return result
  }, [marks, width])
  const close = (restore = false) => {
    setSelection(null)
    if (restore) opener.current?.focus()
  }
  useEffect(() => {
    if (!selection) return
    card.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', outside)
    }
  }, [selection])
  const selected = selection?.moment
  const all = selection?.all ?? marks
  const index = selected ? all.indexOf(selected) : -1
  const details = selected ? categories[selected.kind] : null
  return (
    <div className="almanac-moments" ref={root}>
      {groups.map((group, n) => {
        const first = group[0]!
        const meta = categories[first.kind]
        const fraction =
          group.reduce((sum, m) => sum + (m.tick % MINUTES_PER_DAY), 0) /
          group.length /
          MINUTES_PER_DAY
        const label =
          group.length > 1
            ? `${group.length} moments, ${stamp(first.tick).time} to ${stamp(group[group.length - 1]!.tick).time}`
            : `${stamp(first.tick).time}, ${first.words}`
        return (
          <button
            key={`${first.tick}-${n}`}
            type="button"
            className="almanac-event"
            data-kind={meta.tint}
            style={{ left: `clamp(22px, ${fraction * 100}%, calc(100% - 22px))` }}
            title={label}
            aria-label={label}
            aria-expanded={selection?.openerKey === `${first.tick}-${n}`}
            aria-controls={selection ? id : undefined}
            data-group={n}
            onClick={(event) => {
              if (opener.current === event.currentTarget && selection) {
                close()
                return
              }
              opener.current = event.currentTarget
              const bounds = event.currentTarget.getBoundingClientRect()
              const bar = root.current!.closest('.almanac')!.getBoundingClientRect()
              setSelection({
                openerKey: `${first.tick}-${n}`,
                group,
                groups,
                all: marks,
                moment: group.length === 1 ? first : null,
                left: Math.max(
                  10,
                  Math.min(window.innerWidth - 370, bounds.left + bounds.width / 2 - 180),
                ),
                top: bar.bottom + 8,
              })
            }}
          >
            <span className="almanac-token">
              <GameIcon kind={meta.icon} />
            </span>
            {group.length > 1 && (
              <span className="almanac-count" aria-hidden="true">
                {group.length}
              </span>
            )}
          </button>
        )
      })}
      {selection && (
        <section
          ref={card}
          id={id}
          role="dialog"
          aria-label={selected ? selected.words : `${selection.group.length} nearby moments`}
          className="almanac-card"
          style={{
            left: selection.left,
            top: selection.top,
            maxHeight: `calc(100dvh - ${selection.top + 12}px)`,
          }}
        >
          <div className="almanac-card-head">
            <GameIcon kind="chronicle" />
            <div>
              <b>
                {selected
                  ? `Day ${stamp(selected.tick).day} · ${stamp(selected.tick).time}`
                  : `${selection.group.length} moments`}
              </b>
              <small>
                {selected
                  ? 'A moment from this day'
                  : `${stamp(selection.group[0]!.tick).time} – ${stamp(selection.group[selection.group.length - 1]!.tick).time}`}
              </small>
            </div>
            <button
              type="button"
              aria-label="Close moment"
              onClick={() => {
                close(true)
              }}
            >
              ×
            </button>
          </div>
          {selected && details ? (
            <>
              <div className="almanac-card-body">
                {selection.group.length > 1 && (
                  <button
                    type="button"
                    className="almanac-return"
                    onClick={() => {
                      setSelection({ ...selection, moment: null })
                    }}
                  >
                    ‹ Back to {selection.group.length} nearby moments
                  </button>
                )}
                <p className="almanac-category">
                  <GameIcon kind={details.icon} />
                  {details.label}
                </p>
                <h2>{selected.words}</h2>
              </div>
              <div className="almanac-card-footer">
                <button
                  type="button"
                  data-primary
                  className="almanac-watch"
                  onClick={() => {
                    close(true)
                    onWatch(selected.tick)
                  }}
                >
                  Watch from {stamp(selected.tick).time}
                </button>
                <div className="almanac-nav">
                  <button
                    type="button"
                    aria-label="Previous moment"
                    disabled={index <= 0}
                    onClick={() => {
                      setSelection({
                        ...selection,
                        moment: all[index - 1]!,
                        group: selection.groups.find((g) => g.includes(all[index - 1]!))!,
                      })
                    }}
                  >
                    ‹
                  </button>
                  <span>
                    {index + 1} of {all.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next moment"
                    disabled={index < 0 || index >= all.length - 1}
                    onClick={() => {
                      setSelection({
                        ...selection,
                        moment: all[index + 1]!,
                        group: selection.groups.find((g) => g.includes(all[index + 1]!))!,
                      })
                    }}
                  >
                    ›
                  </button>
                </div>
              </div>
            </>
          ) : (
            <ul className="almanac-list">
              {selection.group.map((m, i) => (
                <li key={`${m.tick}-${i}`}>
                  <button
                    type="button"
                    data-primary={i === 0 ? '' : undefined}
                    onClick={() => {
                      setSelection({ ...selection, moment: m })
                    }}
                  >
                    <GameIcon kind={categories[m.kind].icon} />
                    <span>
                      <time>
                        {stamp(m.tick).time} · {categories[m.kind].label}
                      </time>
                      <b>{m.words}</b>
                    </span>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
