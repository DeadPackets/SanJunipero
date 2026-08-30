import { MOTION } from './motion.js'

/** What the card says while the town is still on its way. Not a spinner: a loading surface in
 *  this world has a shape and a sentence. */
export const FIRST_FRAME_COPY = {
  looking: 'Looking for the town…',
  lost: 'The town is out of reach. Reconnecting.',
}

let card: HTMLElement | null = null
let done = false

/**
 * The title card is static HTML inside `#root`, so it paints on the first byte and is what LCP
 * measures. React clears its own container on mount, so the card steps out of it first and the
 * town comes up underneath — then the card fades and goes.
 */
export function detachFirstFrame(): void {
  card = document.getElementById('first-frame')
  if (card !== null) document.body.append(card)
}

/** What the card is waiting for, in the town's own voice. Ignored once the town has arrived. */
export function firstFrameNote(text: string): void {
  const note = done ? null : card?.querySelector('#first-frame-note')
  if (note != null && note.textContent !== text) note.textContent = text
}

/** The town is here. One way only: a socket that drops later is the stamp's news, not the card's. */
export function dismissFirstFrame(): void {
  if (done || card === null) return
  done = true
  const el = card
  el.classList.add('gone')
  const drop = (): void => {
    el.remove()
  }
  el.addEventListener('transitionend', drop, { once: true })
  // under `prefers-reduced-motion` there is no transition, so nothing would ever end
  setTimeout(drop, MOTION.scene.ms + 100)
}
