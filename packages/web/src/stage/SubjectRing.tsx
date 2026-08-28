import { useEffect, useRef, useState } from 'react'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import { useSubjectAnchor, type Subject } from './anchor.js'

export const RING_VERBS = ['follow', 'story', 'bonds', 'home'] as const
export type RingVerb = (typeof RING_VERBS)[number]

/** The word on the arm, in the town's own language: what the viewer asks the person for. */
export const RING_LABEL: Readonly<Record<RingVerb, string>> = {
  follow: 'Follow',
  story: 'Story',
  bonds: 'Bonds',
  home: 'Home',
}

/** Which arm a key moves to, or null when the ring does not own the press. Wraps, because a
 *  ring has no first arm and no last one. */
export function cycleVerb(index: number, key: string): number | null {
  const n = RING_VERBS.length
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % n
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index + n - 1) % n
    case 'Home':
      return 0
    case 'End':
      return n - 1
    default:
      return null
  }
}

/** Four things to ask, standing round the person you asked. */
export function SubjectRing({
  subject,
  scene,
  onVerb,
  store,
}: {
  subject: Subject | null
  scene: Scene | null
  onVerb: (verb: RingVerb) => void
  /** only a `structure` subject needs it — a body carries its own sprite anchor */
  store?: WorldStore
}) {
  const ref = useSubjectAnchor(scene, subject, store)
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
    if (id !== null) arms.current[0]?.focus()
  }, [id])

  if (subject === null) return null
  return (
    <div ref={ref} className="stage-ring">
      <div className="stage-ring-arms" role="menu" aria-label={subject.name}>
        {RING_VERBS.map((verb, i) => (
          <button
            key={verb}
            ref={(el) => {
              arms.current[i] = el
            }}
            type="button"
            role="menuitem"
            tabIndex={i === at ? 0 : -1}
            onClick={() => {
              onVerb(verb)
            }}
            onKeyDown={(e) => {
              const next = cycleVerb(i, e.key)
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
