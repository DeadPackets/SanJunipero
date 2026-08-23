import { FLING_MAX_MS } from '../render/fling.js'
import { TICK_PERIOD_MAX_MS, WALK_LEAD_TICKS } from '../render/charAnim.js'

export { easeOutCubic } from '../render/camera.js'

/**
 * U23 — ONE VOCABULARY OF MOTION, AND BOTH RUNTIMES SPEAK IT.
 *
 * Motion existed but it was not a system. The sheet carried three unnamed durations and eleven
 * surfaces each picked their own combination in their own rule; the canvas side — the interior
 * fade, the follow lerp, the zoom ease — shared none of it. Nothing named what a duration was
 * FOR, so nothing could be consistent.
 *
 * A motion is named by WHAT IT IS, so two surfaces doing the same thing move the same way.
 */
export const MOTIONS = ['tap', 'reveal', 'enter', 'move', 'scene', 'ambient'] as const
export type MotionName = (typeof MOTIONS)[number]
export type Motion = { ms: number; ease: string; stagger?: number }

export const MOTION: Readonly<Record<MotionName, Motion>> = {
  tap: { ms: 90, ease: 'cubic-bezier(0.3, 0, 0.2, 1)' },                // a press answering
  reveal: { ms: 150, ease: 'cubic-bezier(0.2, 0, 0, 1)' },              // a hover, a chip
  enter: { ms: 240, ease: 'cubic-bezier(0.2, 0, 0, 1)', stagger: 30 },  // a panel arriving
  move: { ms: 180, ease: 'cubic-bezier(0.4, 0, 0.2, 1)' },              // camera, zoom, dock
  scene: { ms: 300, ease: 'cubic-bezier(0.4, 0, 0.2, 1)' },             // lens, interior, day
  ambient: { ms: 1200, ease: 'linear' },                                // breathing, drift
}

/** The band the UI mandate sets. */
export const MOTION_CEILING_MS = 300
export const MOTION_FLOOR_MS = 90

/**
 * ★ EVERY MOTION IN THIS PRODUCT THAT RUNS PAST THE CEILING, AND WHY IT MAY.
 *
 * AN UNWRITTEN EXCEPTION IS A BUG WITH A DELAY FUSE. The next person to read the table sees a
 * number over 300 with nothing beside it, calls it a violation, and "fixes" a thing that was
 * deliberate — or, worse, adds their own long motion because one already exists. So an exemption
 * is a row here with its reason, and a test asserts that every long motion in the product has
 * one. Two do:
 *
 *  · `ambient` is SCENERY. It is never a response to an input, so there is no viewer waiting on
 *    it and no duration the band could be an opinion about.
 *
 *  · `fling` is THE HAND, STILL ARRIVING. The camera lane's drag glide runs to 700 ms and it is
 *    exempt for the mirror of ambient's reason. The band governs a TRANSITION, where the
 *    duration is the product's opinion about how long a viewer waits for an answer. A glide is
 *    not an answer to an input — it is the continuation of a movement the viewer made with their
 *    own hand, and its length is their throw, not our choice. `FLING_MAX_MS` is a safety cut, so
 *    the exempted number is a ceiling nothing normally reaches: a throw ends when it drops under
 *    `FLING_STOP_PX_PER_MS`, which at any speed a hand produces comes first.
 *    (Ruled on by the controller after the camera lane shipped it. `render/fling.ts` carries the
 *    physics; this row is the reason it is allowed to.)
 *
 *  · `walk` is THE WORLD'S OWN CLOCK. A body crosses a tile in one tick of the simulation —
 *    2500 ms by the declared default, 400 in the dev world — and the renderer carries it
 *    across that interval so it arrives as the next tick lands. The duration is not the
 *    product's opinion about how long a viewer waits; it is how long the person takes, and the
 *    only alternative to spending it is teleporting the body 2.5 times a second, which is the
 *    defect the interpolation exists to prevent. The exempted number is `TICK_PERIOD_MAX_MS`,
 *    the widest cadence the clock will believe at all — a real leg is one tick plus at most one
 *    tick of buffer, and both are the world's numbers rather than ours.
 *
 *    This one was ALREADY over the ceiling before the motion lane touched it — the landed
 *    glide ran to 4000 ms — and had no row. An unwritten exception is a bug with a delay fuse
 *    whether or not the lane that wrote it noticed.
 */
export type MotionExemption = { what: string; ms: number; because: string }

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
    because: 'the world’s own clock — a body crosses a tile in a tick of the simulation, and '
      + 'the alternative to spending it is teleporting the body 2.5 times a second',
  },
]

/** The exempt entries that are names in the table above — derived, so the two can never
 *  disagree about which of them the ceiling check should skip. */
export const AMBIENT_EXEMPT: readonly MotionName[] = MOTION_EXEMPT
  .map((e) => e.what)
  .filter((w): w is MotionName => (MOTIONS as readonly string[]).includes(w))

/**
 * The sheet's spelling for each motion. `--t-fast`, `--t-med` and `--t-slow` are the landed
 * names of `reveal`, `enter` and `scene`; they keep their spelling and lose their independence —
 * the value now comes from the table above, and a test proves the two agree.
 */
export const CSS_DURATION_TOKEN: Readonly<Record<MotionName, string>> = {
  tap: '--t-tap', reveal: '--t-fast', enter: '--t-med', move: '--t-move',
  scene: '--t-slow', ambient: '--t-ambient',
}
export const CSS_EASE_TOKEN: Readonly<Record<MotionName, string>> = {
  tap: '--ease-tap', reveal: '--ease-enter', enter: '--ease-enter', move: '--ease-move',
  scene: '--ease-move', ambient: '--ease-ambient',
}

/**
 * Reduced motion is not "no motion": it is INSTANT ARRIVAL. A viewer who opted out still needs
 * to see that something changed, so opacity survives at a third of the duration and every
 * property that moves a box goes to zero. A stagger is movement in time and goes with them.
 */
const OPACITY_PROPS: readonly string[] = ['opacity', 'color', 'background-color', 'border-color', 'fill']

export function reduced(m: Motion, prop: string): Motion {
  if (!OPACITY_PROPS.includes(prop)) return { ms: 0, ease: m.ease }
  return { ms: Math.round(m.ms / 3), ease: m.ease }
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
    let lo = 0, hi = 1
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
  const f = m === null
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
export function durationsIn(css: string): Array<{ selector: string; value: string }> {
  const out: Array<{ selector: string; value: string }> = []
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
          const first = token !== null && (time === undefined || token.index < time.index)
            ? token[0] : time![0].trim()
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
 *  The one legitimate use is finish line 6: a hover arrives over `--t-fast` and leaves the
 *  instant the pointer does, because a hover that fades OUT goes on claiming the pointer is
 *  somewhere it already left. Stated here rather than quietly skipped by the regex. */
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
