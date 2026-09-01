import { FLING_MAX_MS } from '../render/fling.js'
import { TICK_PERIOD_MAX_MS, WALK_LEAD_TICKS } from '../render/charAnim.js'

/** One vocabulary of motion, spoken by both runtimes: a motion is named by WHAT IT IS, so two
 *  surfaces doing the same thing move the same way. */
export const MOTIONS = ['tap', 'reveal', 'enter', 'move', 'scene', 'ambient'] as const
export type MotionName = (typeof MOTIONS)[number]
export type Motion = { ms: number; ease: string; stagger?: number | undefined }

export const MOTION: Readonly<Record<MotionName, Motion>> = {
  tap: { ms: 90, ease: 'cubic-bezier(0.3, 0, 0.2, 1)' }, // a press answering
  reveal: { ms: 150, ease: 'cubic-bezier(0.2, 0, 0, 1)' }, // a hover, a chip
  enter: { ms: 240, ease: 'cubic-bezier(0.2, 0, 0, 1)', stagger: 30 }, // a panel arriving
  move: { ms: 180, ease: 'cubic-bezier(0.4, 0, 0.2, 1)' }, // camera, zoom, dock
  scene: { ms: 300, ease: 'cubic-bezier(0.4, 0, 0.2, 1)' }, // lens, interior, day
  ambient: { ms: 1200, ease: 'linear' }, // breathing, drift
}

/** The band the UI mandate sets. */
export const MOTION_CEILING_MS = 300
export const MOTION_FLOOR_MS = 90

export type MotionExemption = { what: string; ms: number; because: string }

// Motions past MOTION_CEILING_MS; a test asserts every long motion in the product has a row here.
export const MOTION_EXEMPT: readonly MotionExemption[] = [
  {
    what: 'ambient',
    ms: MOTION.ambient.ms,
    because: 'scenery — never a response to an input, so nobody is waiting on it',
  },
  {
    what: 'fling',
    ms: FLING_MAX_MS,
    because: 'the continuation of the viewer’s own hand; its length is their throw, not ours',
  },
  {
    what: 'walk',
    ms: TICK_PERIOD_MAX_MS * (1 + WALK_LEAD_TICKS),
    because:
      'the world’s own clock — a tick of the simulation is shared out among the tiles it ' +
      'carried a body over, and the alternative to spending it is teleporting the body ' +
      '2.5 times a second',
  },
]

/** The exempt entries that are names in the table above — derived, so the two can never
 *  disagree about which of them the ceiling check should skip. */
export const AMBIENT_EXEMPT: readonly MotionName[] = MOTION_EXEMPT.map((e) => e.what).filter(
  (w): w is MotionName => (MOTIONS as readonly string[]).includes(w),
)

/** The sheet's spelling for each motion. The value comes from the table above and a test proves
 *  the two agree. */
export const CSS_DURATION_TOKEN: Readonly<Record<MotionName, string>> = {
  tap: '--t-tap',
  reveal: '--t-fast',
  enter: '--t-med',
  move: '--t-move',
  scene: '--t-slow',
  ambient: '--t-ambient',
}
export const CSS_EASE_TOKEN: Readonly<Record<MotionName, string>> = {
  tap: '--ease-tap',
  reveal: '--ease-enter',
  enter: '--ease-enter',
  move: '--ease-move',
  scene: '--ease-move',
  ambient: '--ease-ambient',
}

/** Reduced motion is a FADE OR NOTHING: every property that moves a box goes to zero, a
 *  stagger with it, and a colour keeps its own duration so an opted-out viewer sees a change. */
const OPACITY_PROPS: readonly string[] = [
  'opacity',
  'color',
  'background-color',
  'border-color',
  'fill',
]

export function reduced(m: Motion, prop: string): Motion {
  return { ms: OPACITY_PROPS.includes(prop) ? m.ms : 0, ease: m.ease }
}

/** A blanket `transition: all` animates whatever a later rule happens to change, which is how a
 *  surface ends up moving something nobody meant to move. */
export function motionCss(name: MotionName, props: readonly string[]): string {
  if (props.length === 0 || props.includes('all')) {
    throw new Error(`motionCss(${name}): name the properties; \`all\` is not a property`)
  }
  return [
    `transition-property: ${props.join(', ')}`,
    `transition-duration: var(${CSS_DURATION_TOKEN[name]})`,
    `transition-timing-function: var(${CSS_EASE_TOKEN[name]})`,
  ].join('; ')
}

// ── the canvas half ────────────────────────────────────────────────────────────────────────

const BEZIER = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/

/** A cubic Bézier on the unit square, solved for x by bisection. Twenty halvings put x within
 *  1e-6, which is finer than any duration this table names can resolve on a frame boundary. */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, t: number): number => {
    const u = 1 - t
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
  }
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let lo = 0,
      hi = 1
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (at(x1, x2, mid) < t) lo = mid
      else hi = mid
    }
    return at(y1, y2, (lo + hi) / 2)
  }
}

const CURVES = new Map<string, (t: number) => number>()

/** The SAME curve the stylesheet declares, evaluated in JS — the canvas cannot drift from the
 *  chrome, because there is one string and both runtimes read it. */
export function easeFn(name: MotionName): (t: number) => number {
  const spec = MOTION[name].ease
  const hit = CURVES.get(spec)
  if (hit !== undefined) return hit
  const m = BEZIER.exec(spec)
  const f =
    m === null
      ? (t: number) => Math.min(1, Math.max(0, t))
      : bezier(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]))
  CURVES.set(spec, f)
  return f
}

/** The eased fraction of `name`'s duration elapsed: 0 at and before the start, exactly 1 at and
 *  after it finishes. Clamped, so a paused tab that wakes late lands at rest, never past it. */
export function progress(name: MotionName, startedMs: number, nowMs: number): number {
  const ms = MOTION[name].ms
  if (ms <= 0) return 1
  const t = (nowMs - startedMs) / ms
  if (t <= 0) return 0
  if (t >= 1) return 1
  return easeFn(name)(t)
}

// ── the scan that keeps the sheet honest ───────────────────────────────────────────────────

const TIME = /(?:^|[\s,(])(\d*\.?\d+)(ms|s)(?![\w-])/g

/** Every duration the sheet states, as `selector — value`. Longhand and shorthand both: a
 *  shorthand's FIRST time is its duration and any second one is a delay, per the CSS grammar. */
export function durationsIn(css: string): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = []
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, prop, raw] of (body ?? '').matchAll(
      /(transition-duration|animation-duration|transition|animation)\s*:\s*([^;}]+)/g,
    )) {
      const value = (raw ?? '').trim()
      if (prop === 'transition' || prop === 'animation') {
        // one duration per comma-separated layer, and only the first time in each
        for (const layer of value.split(',')) {
          const time = [...layer.matchAll(TIME)][0]
          const token = /var\(--[\w-]+\)/.exec(layer)
          if (time === undefined && token === null) continue
          // whichever comes first IS the duration; a second time is a delay (CSS grammar)
          const first =
            token !== null && (time === undefined || token.index < time.index)
              ? token[0]
              : time![0].trim()
          out.push({ selector: (sel ?? '').trim(), value: first })
        }
      } else {
        out.push({ selector: (sel ?? '').trim(), value })
      }
    }
  }
  return out
}

const TOKEN_NAMES = new Set(Object.values(CSS_DURATION_TOKEN))

/** ZERO IS NOT A MOTION, it is the absence of one, so it cannot come from a table of motions.
 *  Stated here rather than quietly skipped by the regex. */
const ZERO = /^0m?s$/

/** A duration written as a number rather than as a name from this table. The report is the
 *  selector, so a regression says where it lives. */
export function untokenisedDurations(css: string): string[] {
  return durationsIn(css)
    .filter((d) => {
      if (ZERO.test(d.value)) return false
      const v = /var\((--[\w-]+)\)/.exec(d.value)?.[1]
      return v === undefined || !TOKEN_NAMES.has(v)
    })
    .map((d) => `${d.selector} — ${d.value}`)
}
