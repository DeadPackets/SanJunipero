import { diffLines, type DiffLine } from './diffLines.js'

// ★ BECOMING — THE SUBSTANCE MEASURE, AND THE AUTHORED-IDENTITY BAN (P22, U12, U26–U31).
//
// THE STANDING MANDATE THIS MODULE EXISTS FOR: the default experiment starts everyone NEUTRAL
// and lets a personality form through play. "It cannot be a deterministic engine because humans
// are non-deterministic." So the panels may not show what a person IS — only what a run has
// MADE of them, and every claim has to be sourced to something that happened in the run.
//
// Three parts, one job:
//   1. `substanceOf` — how much a run has actually made of this person. It is not a score and
//      is never printed; it drives layout density and the gate's day-0 vs day-5 assertion.
//      Genesis facts contribute ZERO by construction, which is what makes it a measure of
//      becoming rather than of being.
//   2. `authoredIdentityOffenders` — the ban, mechanically. If a viewer file reads a handed-down
//      identity field, the scan names the file.
//   3. `changeLog` — the ONE legitimate identity surface in the product, re-framed. The
//      personality endpoint is already a versioned, evolving document with an edit reason; it
//      is presented as WHAT MOVED, and a person with one version is told plainly that nothing
//      has moved yet instead of being handed v1 as a character sheet.

export type SubstanceInput = {
  actsDone: number
  daysLived: number
  bondsAtOrAbove: number
  skillBands: number
  personalityVersions: number
  changeDays: number
}

/**
 * The share of a whole person each kind of evidence carries. They sum to 1, so `substanceOf`
 * needs no clamp to stay in range and a new term cannot silently outweigh the rest.
 *
 * DEVIATION from the plan, which names only the weights: a weight alone cannot turn "31 acts"
 * into a share, so `SUBSTANCE_FULL` says what a full share of each term IS. Two legible tables
 * rather than one table of opaque per-unit constants.
 */
export const SUBSTANCE_WEIGHTS: Readonly<Record<keyof SubstanceInput, number>> = {
  actsDone: 0.25,             // what they have done is the largest part of what they are
  daysLived: 0.15,
  bondsAtOrAbove: 0.2,        // who they know, which no genesis fact can supply
  skillBands: 0.15,
  personalityVersions: 0.1,
  changeDays: 0.15,           // P22.5 — the days they became different
}

/** What "a full share" means for each term, measured against a five-day run. */
export const SUBSTANCE_FULL: Readonly<Record<keyof SubstanceInput, number>> = {
  actsDone: 40, daysLived: 10, bondsAtOrAbove: 4,
  skillBands: 5, personalityVersions: 4, changeDays: 6,
}

const KEYS = Object.keys(SUBSTANCE_WEIGHTS) as Array<keyof SubstanceInput>

/** 0..1. NOT a score and never rendered as a number (P3). */
export function substanceOf(i: SubstanceInput): number {
  let sum = 0
  for (const k of KEYS) {
    const share = Math.min(1, Math.max(0, i[k]) / SUBSTANCE_FULL[k])
    sum += SUBSTANCE_WEIGHTS[k] * share
  }
  return Math.min(1, Math.max(0, sum))
}

// ── the ban ────────────────────────────────────────────────────────────────────────────────

/** A field on this list is something a person was HANDED. The viewer may not read one. */
export const AUTHORED_IDENTITY_FIELDS: readonly string[] =
  ['traits', 'background', 'backstory', 'archetype', 'persona', 'bio', 'origin']

const LINE_COMMENT = /\/\/[^\n]*/g
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g

/**
 * Every viewer file that READS one of those fields. A read is `a.traits`, `a?.traits`,
 * `a['traits']` or `const { traits } = a` — never `{ background: RED }`, which is a style key
 * being written and not an identity being consulted. Word boundaries keep `backgroundImage`
 * and `originX` out of it.
 */
export function authoredIdentityOffenders(
  files: ReadonlyArray<{ path: string; source: string }>,
): string[] {
  const patterns = AUTHORED_IDENTITY_FIELDS.map((f) => new RegExp(
    // .field | ?.field | ['field'] | ["field"] | { field } destructuring
    `(?:\\?\\.|\\.)${f}\\b|\\[\\s*['"]${f}['"]\\s*\\]|\\{[^{}\\n]*\\b${f}\\b[^{}\\n]*\\}\\s*=`,
  ))
  const out: string[] = []
  for (const f of files) {
    if (f.path.endsWith('becoming.ts')) continue    // the one module allowed to name them
    const stripped = f.source.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, ' ')
    if (patterns.some((p) => p.test(stripped))) out.push(f.path)
  }
  return out
}

// ── the honest empty lines ─────────────────────────────────────────────────────────────────

/**
 * P22.2: the two literals that presented an empty RECORD as a fact about a PERSON. They are
 * deleted, not softened, and a test asserts they appear nowhere in the viewer.
 */
export const REMOVED_PLACEHOLDERS: readonly string[] =
  ['Their mind is quiet.', 'Still learning everything.']

/** M6: what has not been written down yet — never a claim about an inner life, and never a
 *  claim that the world has not begun. */
export const THOUGHT_EMPTY = 'Nothing they have thought has been written down yet.'
export const SKILLS_EMPTY = 'They have not taken up a craft yet.'
export const CHANGE_EMPTY = 'Nothing about them has changed yet — they have only just arrived.'

// ── the Character tab, re-framed as WHAT MOVED ─────────────────────────────────────────────

export type PersonalityRow = { version: number; day: number; doc: string; edit: string }
export type ChangeEntry = { version: number; day: number; edit: string; diff: DiffLine[] }

/**
 * Newest first, each entry carrying the diff against the version before it. The FIRST version
 * has nothing before it, so its diff is empty — and the panel reads that as "nothing has
 * changed yet" rather than presenting the founding document as a character sheet.
 */
export function changeLog(rows: readonly PersonalityRow[]): ChangeEntry[] {
  const asc = [...rows].sort((a, b) => a.version - b.version)
  return asc
    .map((row, i): ChangeEntry => ({
      version: row.version, day: row.day, edit: row.edit,
      diff: i === 0 ? [] : diffLines(asc[i - 1]!.doc, row.doc),
    }))
    .reverse()
}

/** Whether this person has actually changed, as opposed to merely having been written down. */
export function hasChanged(log: readonly ChangeEntry[]): boolean {
  return log.some((e) => e.diff.length > 0)
}
