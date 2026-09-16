import { useEffect, useRef } from 'react'

export type StageKey =
  | 'signpost'
  | 'escape'
  | 'fullscreen'
  | 'director'
  | 'thoughts'
  | 'density'
  | 'dock'

export type StageKeyHandlers = {
  onSignpost?: () => void
  onEscape?: () => void
  onFullscreen?: () => void
  onDirector?: () => void
  onThoughts?: () => void
  onDensity?: () => void
  onDock?: () => void
}

/** The seven keys the stage itself owns. The arrows, `+` and `-` are NOT here: StageMount binds
 *  them to the camera already, and a second binding would pan twice. */
export function stageKeyFor(key: string): StageKey | null {
  // `toLowerCase`, so Caps Lock keeps the keys; the SHIFT key is what the listener refuses,
  // because a capital S typed anywhere outside a field used to open the signpost.
  switch (key.toLowerCase()) {
    case 's':
      return 'signpost'
    case 'escape':
      return 'escape'
    case 'f':
      return 'fullscreen'
    case 'd':
      return 'director'
    case 't':
      return 'thoughts'
    case '[':
      return 'density'
    case 'a':
      return 'dock'
    default:
      return null
  }
}

/** Typing an `s` into a field is a letter, never a signpost. */
export function stageKeyAllowed(tagName: string, editable: boolean): boolean {
  return !editable && !/^(INPUT|TEXTAREA|SELECT)$/.test(tagName)
}

/** A browser may refuse it (no user gesture, an iframe without the permission); the stage stays
 *  as it is. */
export function toggleFullscreen(el: Element | null): void {
  const refused = (): void => {
    /* the browser would not grant it; the stage stays the size it is */
  }
  if (document.fullscreenElement !== null) {
    void document.exitFullscreen().catch(refused)
    return
  }
  if (el === null) return
  void el.requestFullscreen().catch(refused)
}

const HANDLER: Readonly<Record<StageKey, keyof StageKeyHandlers>> = {
  signpost: 'onSignpost',
  escape: 'onEscape',
  fullscreen: 'onFullscreen',
  director: 'onDirector',
  thoughts: 'onThoughts',
  density: 'onDensity',
  dock: 'onDock',
}

export function useStageKeys(handlers: StageKeyHandlers): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      const key = stageKeyFor(e.key)
      if (key !== 'escape' && !stageKeyAllowed(t?.tagName ?? '', t?.isContentEditable ?? false))
        return
      if (key === null) return
      const run = latest.current[HANDLER[key]]
      if (run === undefined) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}
