import { MOTION } from './motion.js'

export const FIRST_FRAME_COPY = {
  looking: 'Looking for the town…',
  lost: 'The town is out of reach. Reconnecting.',
  blind: 'This browser cannot draw the town.',
}

let card: HTMLElement | null = null
let done = false

/** React clears `#root` on mount, so the static title card — the LCP element — steps out of
 *  it first and the town comes up underneath. */
export function detachFirstFrame(): void {
  card = document.getElementById('first-frame')
  if (card !== null) document.body.append(card)
}

/** What the card is waiting for, in the town's own voice. Ignored once the town has arrived. */
export function firstFrameNote(text: string): void {
  const note = done ? null : card?.querySelector('#first-frame-note')
  if (note != null && note.textContent !== text) note.textContent = text
}

/** The town will never arrive: say why, and let nothing write over it — "Looking for the town…"
 *  is a lie once the canvas has failed, and there is no town underneath to uncover. */
export function firstFrameStuck(text: string): void {
  firstFrameNote(text)
  done = true
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
