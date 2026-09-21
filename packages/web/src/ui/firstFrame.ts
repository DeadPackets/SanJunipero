import { MOTION } from './motion.js'

export const FIRST_FRAME_COPY = {
  looking: 'Looking for the town…',
  lost: 'The town is out of reach. Reconnecting.',
  blind: 'This browser cannot draw the town.',
}

let card: HTMLElement | null = null
let done = false
let loading = false

/** React clears `#root` on mount, so the static title card — the LCP element — steps out of
 *  it first and the town comes up underneath. */
export function detachFirstFrame(): void {
  card = document.getElementById('first-frame')
  if (card !== null) document.body.append(card)
}

/** What the card is waiting for, in the town's own voice. Ignored once the town has arrived. */
export function firstFrameNote(text: string): void {
  if (loading) return
  const note = done ? null : card?.querySelector('#first-frame-note')
  if (note != null && note.textContent !== text) note.textContent = text
}

/** The town will never arrive: say why, and let nothing write over it — "Looking for the town…"
 *  is a lie once the canvas has failed, and there is no town underneath to uncover. */
export function firstFrameStuck(text: string): void {
  loading = false
  firstFrameNote(text)
  done = true
}

/** The town is here. One way only: a socket that drops later is the stamp's news, not the card's. */
export function dismissFirstFrame(): void {
  if (done || card === null) return
  done = true
  fade(card)
}

/** Fade a mark out on the world's own `scene` motion and take it out of the tree. Under
 *  `prefers-reduced-motion` there is no transition, so nothing would ever end: the timer does. */
function fade(el: HTMLElement): void {
  el.classList.add('gone')
  const drop = (): void => {
    el.remove()
  }
  el.addEventListener('transitionend', drop, { once: true })
  setTimeout(drop, MOTION.scene.ms + 100)
}

export function firstFrameProgress(loaded: number, total: number): void {
  loading = true
  const note = card?.querySelector('#first-frame-note')
  if (note) note.textContent = `Preparing the town · ${loaded} of ${total} assets`
  const meter = card?.querySelector<HTMLProgressElement>('progress')
  if (meter) {
    meter.hidden = false
    meter.max = Math.max(1, total)
    meter.value = loaded
  }
}

export function firstFrameRetry(failed: number, signal: AbortSignal): Promise<void> {
  const note = card?.querySelector('#first-frame-note')
  if (note) note.textContent = `${failed} assets could not load. Check your connection and retry.`
  return new Promise((resolve, reject) => {
    const button = document.createElement('button')
    button.textContent = 'Retry loading'
    button.type = 'button'
    const abort = () => {
      button.remove()
      reject(new DOMException('Loading cancelled', 'AbortError'))
    }
    button.onclick = () => {
      button.remove()
      signal.removeEventListener('abort', abort)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
    card?.append(button)
  })
}
