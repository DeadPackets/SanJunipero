// ★ THE TIC RULE, OVER EVERY CAST IN THE REPOSITORY — INCLUDING THE ONES IN `scripts/`.
//
// `founderMinds.test.ts` holds the same rule over the shared cast by IMPORTING it. That cannot
// reach the probe casts: `scripts/*.ts` are executables with top-level side effects, so a test
// that imported one would boot a world and spend real money to read a string. This reads the
// source text instead, which costs nothing and covers the files an import cannot touch.
//
// The rule it enforces is measured, not stylistic. Across 6 867 lines of real mind output the
// only two minds with a stock opener were the only two whose card named words to SAY as a
// quoted string; the minds whose tics were written as behaviours produced no opener at all.
// A literal tic string is the mechanism, so the string is what is forbidden.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url))

const sources = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Source with comments blanked. A cast is code; a comment that quotes a tic to explain it is
 *  not a cast, and this file would otherwise fail on the prose that documents the rule. */
const uncommented = (src: string): string => {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const two = src.slice(i, i + 2)
    if (two === '//') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue }
    if (two === '/*') { i += 2; while (i < src.length && src.slice(i, i + 2) !== '*/') i++; i++; continue }
    const q = src[i]!
    if (q === '"' || q === "'" || q === '`') {
      out += q
      for (i++; i < src.length && src[i] !== q; i++) {
        out += src[i]
        if (src[i] === '\\') { out += src[i + 1] ?? ''; i++ }
      }
      out += q
      continue
    }
    out += q
  }
  return out
}

/** The balanced span starting at `from`, which must be an opening bracket. Strings are skipped
 *  so a bracket inside a backstory does not close the array early. */
const span = (src: string, from: number): string => {
  const open = src[from]!
  const close = open === '[' ? ']' : open === '{' ? '}' : ')'
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const c = src[i]!
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === open) depth++
    else if (c === close && --depth === 0) return src.slice(from, i + 1)
  }
  return src.slice(from)
}

/** The string entries of an array literal, in order. */
const entries = (arrayLiteral: string): string[] => {
  const out: string[] = []
  for (let i = 1; i < arrayLiteral.length - 1; i++) {
    const c = arrayLiteral[i]!
    if (c !== '"' && c !== "'" && c !== '`') continue
    let s = ''
    for (i++; i < arrayLiteral.length && arrayLiteral[i] !== c; i++) {
      if (arrayLiteral[i] === '\\') { s += arrayLiteral[i + 1] ?? ''; i++; continue }
      s += arrayLiteral[i]
    }
    out.push(s)
  }
  return out
}

/** Top-level arguments of a `(...)` span. */
const args = (parenSpan: string): string[] => {
  const out: string[] = []
  let depth = 0, start = 1
  for (let i = 1; i < parenSpan.length; i++) {
    const c = parenSpan[i]!
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < parenSpan.length && parenSpan[i] !== c; i++) if (parenSpan[i] === '\\') i++
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' && depth === 0) { out.push(parenSpan.slice(start, i)); break }
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { out.push(parenSpan.slice(start, i)); start = i + 1 }
  }
  return out.map((a) => a.trim())
}

type Card = { file: string; tics: string[]; exampleLines: string[] }

/** Every voice card written down anywhere, in either of the two shapes this repo uses: the
 *  `voice(register, rhythm, tics, neverSays, exampleLines, …)` helper each probe defines for
 *  itself, and a plain `{ tics: […], …, exampleLines: […] }` object literal. */
const cards = (): Card[] => {
  const found: Card[] = []
  for (const file of sources(PACKAGES)) {
    const src = uncommented(readFileSync(file, 'utf8'))
    const rel = path.relative(PACKAGES, file)

    for (const m of src.matchAll(/(?<![A-Za-z0-9_$])voice\s*\(/g)) {
      const open = m.index! + m[0].length - 1
      // `function voice(` and `const voice = (` are the helper's definition, not a cast.
      if (/(?:function|=)\s*$/.test(src.slice(Math.max(0, m.index! - 12), m.index!))) continue
      const a = args(span(src, open))
      if (a.length < 5 || !a[2]!.startsWith('[') || !a[4]!.startsWith('[')) continue
      found.push({ file: rel, tics: entries(a[2]!), exampleLines: entries(a[4]!) })
    }

    for (const m of src.matchAll(/\btics\s*:\s*\[/g)) {
      const open = m.index! + m[0].length - 1
      const ticsSpan = span(src, open)
      const rest = src.slice(open + ticsSpan.length)
      const ex = /\bexampleLines\s*:\s*\[/.exec(rest.split(/\btics\s*:/)[0] ?? '')
      found.push({
        file: rel,
        tics: entries(ticsSpan),
        exampleLines: ex ? entries(span(rest, ex.index + ex[0].length - 1)) : [],
      })
    }
  }
  return found
}

// A tic that hands a mind words to utter, rather than describing what the mind does. The verb
// list is the introducer, and the quotes are the utterance; `calls food "provisions"` and
// `calls the path "the way"` are deliberately NOT caught — they name a thing mid-sentence, they
// are how Amara's, Nadia's and Salma's cards are written, and none of those produced an opener.
const UTTERANCE = /\b(say|says|saying|open|opens|start|starts|begin|begins|greet|greets|answer|answers|replies|reply)\b[^"'“]{0,20}["'“]/i

describe('★ a tic is a habit, not a script — over every cast in the repo', () => {
  it('finds the casts it is meant to be guarding', () => {
    // Without this the suite passes by scanning nothing, which is the failure mode a static
    // guard actually has. These four files are where a cast is written down today.
    const files = new Set(cards().map((c) => c.file))
    for (const expected of [
      'agents/src/live/founderMinds.ts',
      'agents/scripts/g11-deepworld.ts',
      'agents/scripts/g9-livingworld.ts',
      'agents/src/persona/tamar.ts',
    ]) expect(files, `no cast found in ${expected}`).toContain(expected)
    expect(cards().length).toBeGreaterThanOrEqual(15)
  })

  it('no cast anywhere defines a tic as words to say', () => {
    for (const card of cards()) {
      for (const tic of card.tics) {
        expect(UTTERANCE.test(tic), `${card.file}: tic "${tic}" hands the mind a literal to say`)
          .toBe(false)
      }
    }
  })

  it('and no card demonstrates a quoted tic in opening position', () => {
    // The other half of the same defect: naming the words and then showing them first is what
    // put "Now then" at the head of 63% of Omar's lines. `founderMinds.test.ts` holds this over
    // the shared cast; this holds it over the probe casts too.
    for (const card of cards()) {
      for (const tic of card.tics) {
        for (const quoted of tic.match(/"([^"]+)"/g) ?? []) {
          const words = quoted.slice(1, -1).toLowerCase()
          for (const line of card.exampleLines) {
            expect(line.toLowerCase().replace(/[^a-z' ]/g, ''),
              `${card.file}: a card demonstrates ${quoted} as an opener`)
              .not.toMatch(new RegExp(`^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`))
          }
        }
      }
    }
  })

  it('and the scanner is the real one — a planted tic is caught in both shapes', () => {
    // Mutation proof kept in the suite, so the guard cannot rot into one that scans nothing.
    for (const planted of ['says "now then"', 'says "aye"', 'opens with "well now"']) {
      expect(UTTERANCE.test(planted), `${planted} should be caught`).toBe(true)
    }
    for (const allowed of [
      'counts aloud', 'understates', 'agrees in one word', 'calls the path "the way"',
      'settles a person before he begins', 'calls food "provisions"',
    ]) expect(UTTERANCE.test(allowed), `${allowed} should be allowed`).toBe(false)
  })
})
