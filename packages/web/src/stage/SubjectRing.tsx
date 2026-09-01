import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { entersOnClick } from '../render/entities.js'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import { useSubjectAnchor, type Reach, type Subject } from './anchor.js'

/** What a person can be asked. A building is asked something else — see `ringVerbsFor`. */
export const PERSON_VERBS = ['follow', 'story', 'bonds', 'home'] as const
export const RING_VERBS = [...PERSON_VERBS, 'inside'] as const
export type RingVerb = (typeof RING_VERBS)[number]

export const RING_LABEL: Readonly<Record<RingVerb, string>> = {
  follow: 'Follow',
  story: 'Story',
  bonds: 'Bonds',
  home: 'Home',
  inside: 'Look inside',
}

/** ★ A well was offered Follow, Bonds and Home. A building has a story, and a roofed one has a
 *  way in; nothing is offered an arm that would do nothing when it is pressed. */
export function ringVerbsFor(kind: Subject['kind'], enterable: boolean): readonly RingVerb[] {
  if (kind === 'agent') return PERSON_VERBS
  return enterable ? ['story', 'inside'] : ['story']
}

/** The arms stand at 12, 3, 6 and 9 o'clock, so an arrow points at one rather than stepping
 *  round a list: every arm is one press away from every other. A ring of two has no 6 and no 9,
 *  so those keys point at nothing rather than at an arm that is not drawn. */
export function armFor(key: string, count: number): number | null {
  const at = (i: number): number | null => (i < count ? i : null)
  switch (key) {
    case 'ArrowUp':
    case 'Home':
      return 0
    case 'ArrowRight':
      return at(1)
    case 'ArrowDown':
      return at(2)
    case 'ArrowLeft':
      return at(3)
    case 'End':
      return count - 1
    default:
      return null
  }
}

/** Half the ring's real footprint: the 124px circle, plus an arm hung off each side of it and
 *  the 26px the whole mark is lifted by (chrome.css `.stage-ring`, `.stage-ring-arms`). */
const RING_REACH: Reach = { x: 100, y: 110 }

/** Whether THIS subject has a way in. A person never does; the building answers for itself. */
function wayIn(store: WorldStore, subject: Subject | null): boolean {
  if (subject?.kind !== 'structure') return false
  return entersOnClick(store.getConfig(), store.getState(), subject.id)
}

export function SubjectRing({
  subject,
  scene,
  store,
  onVerb,
}: {
  subject: Subject | null
  scene: Scene | null
  store: WorldStore
  onVerb: (verb: RingVerb) => void
}) {
  const ref = useSubjectAnchor(scene, subject, RING_REACH)
  // Read through the store, not off the pick: a shell that finishes while it is ringed grows
  // its way in, and one that burns down loses it.
  const read = (): boolean => wayIn(store, subject)
  const enterable = useSyncExternalStore(store.subscribe, read, read)
  const [at, setAt] = useState(0)
  const arms = useRef<(HTMLButtonElement | null)[]>([])
  const id = subject?.id ?? null

  // A ring opened over somebody new opens on its first arm, with the focus already in it, so
  // the keyboard path and the pointer path arrive at the same place.
  const [openedOn, setOpenedOn] = useState(id)
  if (id !== openedOn) {
    setOpenedOn(id)
    setAt(0)
  }
  useEffect(() => {
    if (id === null) return
    // Only when the pick came from a hand. A ring resolved from the address bar arrives with no
    // input from the viewer, and taking their focus for it is WCAG 3.2.1.
    const picked = document.activeElement?.closest('.stage-mount, .stage-figures') ?? null
    if (picked === null) return
    arms.current[0]?.focus()
  }, [id])

  if (subject === null) return null
  const verbs = ringVerbsFor(subject.kind, enterable)
  // A ring that shrinks under the focus must still have ONE tab stop, or Tab cannot reach it.
  const on = Math.min(at, verbs.length - 1)
  return (
    <div ref={ref} className="stage-ring">
      <div className="stage-ring-arms" role="menu" aria-label={subject.name}>
        {verbs.map((verb, i) => (
          <button
            key={verb}
            ref={(el) => {
              arms.current[i] = el
            }}
            type="button"
            role="menuitem"
            tabIndex={i === on ? 0 : -1}
            onClick={() => {
              onVerb(verb)
            }}
            onKeyDown={(e) => {
              const next = armFor(e.key, verbs.length)
              if (next === null) return
              // The stage owns the arrows for panning and reads them off this same React tree.
              e.preventDefault()
              e.stopPropagation()
              setAt(next)
              arms.current[next]?.focus()
            }}
          >
            {RING_LABEL[verb]}
          </button>
        ))}
      </div>
    </div>
  )
}
