import { useEffect, useRef } from 'react'

export type StageKey = 'signpost' | 'escape' | 'fullscreen' | 'director'

export type StageKeyHandlers = {
  onSignpost?: () => void
  onEscape?: () => void
  onFullscreen?: () => void
  onDirector?: () => void
}

/** The four keys the stage itself owns. The arrows, `+` and `-` are NOT here: StageMount binds
 *  them to the camera already, and a second binding would pan twice. */
export function stageKeyFor(key: string): StageKey | null {
  switch (key.toLowerCase()) {
    case 's':
      return 'signpost'
    case 'escape':
      return 'escape'
    case 'f':
      return 'fullscreen'
    case 'd':
      return 'director'
    default:
      return null
  }
}

/** Typing an `s` into a field is a letter, never a signpost. */
export function stageKeyAllowed(tagName: string, editable: boolean): boolean {
  return !editable && !/^(INPUT|TEXTAREA|SELECT)$/.test(tagName)
}

/** Fullscreen for the stage element, or back out of it. Rejected by a browser that will not
 *  grant it (no user gesture, an iframe without the permission) and the stage stays as it is. */
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

export function useStageKeys(handlers: StageKeyHandlers): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (!stageKeyAllowed(t?.tagName ?? '', t?.isContentEditable ?? false)) return
      const which = stageKeyFor(e.key)
      if (which === null) return
      const h = latest.current
      const byKey: Record<StageKey, (() => void) | undefined> = {
        signpost: h.onSignpost,
        escape: h.onEscape,
        fullscreen: h.onFullscreen,
        director: h.onDirector,
      }
      const run = byKey[which]
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
