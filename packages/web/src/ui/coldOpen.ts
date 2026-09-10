import { useCallback, useEffect, useState } from 'react'
import { MOTION } from './motion.js'

// ── the cold open ──────────────────────────────────────────────────────────────────────────
// The title card says the town is being looked for. This says what the town IS, over the town
// itself, once there is art to see. One sentence, and it is the only thing the interface ever
// says about itself.

/** A beat after the town is dressed, so the line lands ON the picture instead of with it. */
export const COLD_OPEN_IN_MS = 400

/** When the line clears and the product is simply running, measured from the reveal. */
const COLD_OPEN_OUT_MS = 12_000

/** Art that never lands may not hold the first frame for ever. */
export const COLD_OPEN_WAIT_MS = 3000

/** The sheet's own fade, so the mark is out of the tree once it cannot be seen. */
export const COLD_OPEN_FADE_MS = MOTION.scene.ms

/** How often the sequence is re-asked. Nothing counts down on screen: this is the switch
 *  between three states, not a clock anybody reads. */
const COLD_OPEN_STEP_MS = 200

/** Spelled, not counted: the first thing a visitor reads is prose, and a numeral in it reads as
 *  an instrument. Past twenty the town is bigger than the sentence and the figure is honest. */
const NUMBER_WORDS = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
]

export function peopleWords(count: number): string {
  const n = Math.max(0, Math.trunc(count))
  const word = NUMBER_WORDS[n] ?? String(n)
  return n === 1 ? `${word} person` : `${word} people`
}

/** ★ The count is the world's own living bodies. A town of six says six: a number this file
 *  held would be the one law this project keeps breaking. */
export const coldOpenLine = (living: number): string =>
  `${peopleWords(living)} live here. Nobody wrote what they do next.`

/** The second line names one person and what is on their mind, in the words of their own card.
 *  The worries arrive by feed a beat after the town does, so the line is added when they land.
 *  Chosen by the day, so a visit tomorrow opens on somebody else. */
export function firstWorryLine(
  aims: readonly { agentId: string; worry: string | null }[],
  nameOf: (id: string) => string | undefined,
  day: number,
): string | null {
  const carried = aims.filter((a): a is { agentId: string; worry: string } => a.worry !== null)
  if (carried.length === 0) return null
  const pick = carried[((day % carried.length) + carried.length) % carried.length]!
  const name = nameOf(pick.agentId)
  if (name === undefined) return null
  const worry = pick.worry.trim().replace(/\.$/, '')
  return `On ${name}’s mind: ${worry}.`
}

/** What the first frame says this instant. `gone` is the fade running, `spent` is the sequence
 *  over for the whole session. */
export type ColdOpenFrame = { line: string | null; gone: boolean; spent: boolean }

export type ColdOpen = {
  at: (nowMs: number, town: { dressed: boolean; living: number }) => ColdOpenFrame
  /** Something better to look at arrived, or a hand went on the camera. */
  dismiss: (nowMs: number) => void
}

/** A hand on the camera: the same three the director stands down for. */
const HAND_ON_CAMERA = ['pointerdown', 'keydown', 'wheel'] as const

const NOTHING: ColdOpenFrame = { line: null, gone: false, spent: false }
const OVER: ColdOpenFrame = { line: null, gone: true, spent: true }

export function coldOpen(startedMs: number): ColdOpen {
  let shownMs: number | null = null
  let outMs: number | null = null
  let line: string | null = null
  return {
    at(nowMs, town) {
      if (shownMs === null) {
        if (outMs !== null) return OVER
        // An empty town has nothing to say here, and the reveal waits on ART rather than on the
        // scene object: that is the whole of what stops the pop-in.
        if (town.living < 1) return NOTHING
        if (!town.dressed && nowMs - startedMs < COLD_OPEN_WAIT_MS) return NOTHING
        shownMs = nowMs
        line = coldOpenLine(town.living)
      }
      const out = outMs ?? shownMs + COLD_OPEN_OUT_MS
      if (nowMs >= out + COLD_OPEN_FADE_MS) return OVER
      if (nowMs >= out) return { line, gone: true, spent: false }
      return { line: nowMs - shownMs < COLD_OPEN_IN_MS ? null : line, gone: false, spent: false }
    },
    dismiss(nowMs) {
      outMs ??= nowMs
    },
  }
}

export function useColdOpen(
  dressed: boolean,
  living: number,
): { frame: ColdOpenFrame; dismiss: () => void } {
  const [open] = useState(() => coldOpen(performance.now()))
  const [frame, setFrame] = useState<ColdOpenFrame>(NOTHING)
  const dismiss = useCallback(() => {
    open.dismiss(performance.now())
    setFrame(open.at(performance.now(), { dressed: false, living: 0 }))
  }, [open])
  useEffect(() => {
    for (const ev of HAND_ON_CAMERA)
      window.addEventListener(ev, dismiss, { passive: true, once: true })
    return () => {
      for (const ev of HAND_ON_CAMERA) window.removeEventListener(ev, dismiss)
    }
  }, [dismiss])
  useEffect(() => {
    let timer = 0
    const step = (): void => {
      const next = open.at(performance.now(), { dressed, living })
      setFrame(next)
      if (!next.spent) timer = window.setTimeout(step, COLD_OPEN_STEP_MS)
    }
    step()
    return () => {
      clearTimeout(timer)
    }
  }, [open, dressed, living])
  return { frame, dismiss }
}
