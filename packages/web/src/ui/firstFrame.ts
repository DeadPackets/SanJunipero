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

// ── the two lines over the first shot ──────────────────────────────────────────────────────
// The card above says the town is being looked for. These say what the town IS, over the town
// itself, and get out of the way the moment the viewer has something better to look at.

/** How long the lines stand if nothing happens at all. Twenty seconds is the same patience the
 *  director's own hand-back waits (`ui/autoCut.ts`). */
export const FIRST_LINES_MS = 20_000

/** The half of the copy that is fixed. The other half counts the town, so it is built. */
export const FIRST_LINES = { take: 'The camera finds the moments; drag to take it.' }

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

/** A novel's first line, not a builder's: the people, the place, and that nothing between
 *  them is settled yet. As true on day forty as on day one. */
export const firstLinesHead = (count: number): string =>
  `${peopleWords(count)}, one valley, and everything between them still to be settled.`

/** The second line names one person and what is on their mind, in the words of their own card.
 *  The worries arrive by feed a beat after the town does, so the line is added when they land,
 *  and only while the first lines are still up. Chosen by the day, so a visit tomorrow opens on
 *  somebody else. */
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

export function tellFirstWorry(line: string | null): void {
  if (lines === null || line === null) return
  const el = lines.querySelector<HTMLElement>('.first-lines-worry')
  if (el === null) return
  el.textContent = line
  el.hidden = false
}

/** A hand on the camera: the same three the director stands down for. */
const HAND_ON_CAMERA = ['pointerdown', 'keydown', 'wheel'] as const

let lines: HTMLElement | null = null
let linesDone = false

/** The town has arrived and has people in it. A town with nobody in it has nothing to say here,
 *  and once the lines have gone they never come back. */
export function showFirstLines(count: number): void {
  if (linesDone || lines !== null || count < 1) return
  const el = document.getElementById('first-frame-lines')
  if (el === null) return
  lines = el
  const head = el.querySelector('.first-lines-head')
  if (head != null) head.textContent = firstLinesHead(count)
  el.hidden = false
  for (const ev of HAND_ON_CAMERA)
    window.addEventListener(ev, fadeFirstLines, { passive: true, once: true })
  setTimeout(fadeFirstLines, FIRST_LINES_MS)
}

/** The first cut, the first hand on the camera, or twenty seconds — whichever comes first. */
export function fadeFirstLines(): void {
  if (linesDone) return
  linesDone = true
  for (const ev of HAND_ON_CAMERA) window.removeEventListener(ev, fadeFirstLines)
  const el = lines
  lines = null
  if (el !== null) fade(el)
}
