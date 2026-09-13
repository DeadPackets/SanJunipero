import { useCallback, useEffect, useRef, useState } from 'react'
import { localStore } from './storage.js'

// ── the three densities ────────────────────────────────────────────────────────────────────
// Stage is the world alone, Watch adds the ribbon and the beat card, Deck adds the rail and the
// board. Stage is the default and Deck is the reward. Nothing reflows between them: a mode
// change is a fade, so the world keeps every pixel it had in all three.

export const DENSITIES = ['stage', 'watch', 'deck'] as const
export type Density = (typeof DENSITIES)[number]

/** No hand anywhere for this long and the chrome stands down to the world alone. */
export const DENSITY_IDLE_MS = 90_000

/** How often the idle is re-asked. Nothing counts down on screen: this is a switch, not a clock
 *  anybody reads. */
const DENSITY_STEP_MS = 1000

const DENSITY_KEY = 'sj:density'

/** How this browser likes the town shown. No memory at all is a first visit, and a first visit
 *  is the world alone. A word this build does not know is a word a later one wrote. */
export function densitySetting(storage: Pick<Storage, 'getItem'> | null): Density {
  try {
    const said = storage?.getItem(DENSITY_KEY)
    return DENSITIES.find((d) => d === said) ?? 'stage'
  } catch {
    return 'stage'
  }
}

export function rememberDensity(storage: Pick<Storage, 'setItem'> | null, v: Density): void {
  try {
    storage?.setItem(DENSITY_KEY, v)
  } catch {
    /* nothing to do: the choice holds for this page and is asked again on the next */
  }
}

export function nextDensity(mode: Density): Density {
  return DENSITIES[(DENSITIES.indexOf(mode) + 1) % DENSITIES.length]!
}

/** The demote, pure over the clock so a test drives it with no timer. */
export function demoted(nowMs: number, lastHandMs: number, mode: Density): Density {
  return nowMs - lastHandMs >= DENSITY_IDLE_MS ? 'stage' : mode
}

/** The promote: any input from Stage brings back the last mode this browser asked for. */
export function promoted(mode: Density, remembered: Density): Density {
  return mode === 'stage' ? remembered : mode
}

/** ★ A HAND ON THE INTERFACE, NOT ON THE CAMERA. `cameraClaim`'s three are a hand on the lens,
 *  and by that reading a viewer reading the dossier rail without touching the canvas loses it
 *  after ninety seconds. Reading is a hand. */
const HAND = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const

export type DensityControl = {
  mode: Density
  /** the `[` key: stage, watch, deck, round again */
  cycle: () => void
  /** a click on a person asks for the deck; the choice is remembered as any other is */
  show: (next: Density) => void
}

export function useDensity(): DensityControl {
  const [mode, setMode] = useState<Density>(() => densitySetting(localStore()))
  // The clock is read on mount, never in render: a render is not a moment in time.
  const at = useRef({ mode, remembered: mode, hand: 0 })

  const show = useCallback((next: Density) => {
    at.current = { mode: next, remembered: next, hand: Date.now() }
    rememberDensity(localStore(), next)
    setMode(next)
  }, [])

  const cycle = useCallback(() => {
    show(nextDensity(at.current.mode))
  }, [show])

  useEffect(() => {
    at.current.hand = Date.now()
    const hand = (): void => {
      at.current.hand = Date.now()
      const up = promoted(at.current.mode, at.current.remembered)
      if (up === at.current.mode) return
      at.current.mode = up
      setMode(up)
    }
    for (const ev of HAND) window.addEventListener(ev, hand, { passive: true })
    const timer = window.setInterval(() => {
      const down = demoted(Date.now(), at.current.hand, at.current.mode)
      if (down === at.current.mode) return
      at.current.mode = down
      setMode(down)
    }, DENSITY_STEP_MS)
    return () => {
      for (const ev of HAND) window.removeEventListener(ev, hand)
      clearInterval(timer)
    }
  }, [])

  return { mode, cycle, show }
}
