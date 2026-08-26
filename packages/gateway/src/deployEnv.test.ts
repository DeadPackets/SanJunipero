// A knob documented as a `.env` toggle that `compose.yaml` never passes through is a setting an
// operator can set, read back in the docs, and watch do nothing. The docs are the specification
// and compose.yaml is the answer to it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = new URL('../../../', import.meta.url)
const read = (p: string): string => readFileSync(fileURLToPath(new URL(p, REPO)), 'utf8')

const README = read('README.md')
const DEPLOY_README = read('deploy/README.md')
const ENV_EXAMPLE = read('deploy/.env.example')
const COMPOSE = read('compose.yaml')

/** The env table in README.md: one row per knob, `dev:world`-only rows excluded because they
 *  belong to `pnpm dev:world`, which no container runs. */
function documentedKnobs(): string[] {
  const names = new Set<string>()
  for (const line of README.split('\n')) {
    const m = /^\|\s*`(SJ_[A-Z0-9_]+)`\s*\|/.exec(line)
    if (m === null || line.includes('`dev:world` only')) continue
    names.add(m[1]!)
  }
  for (const text of [DEPLOY_README, ENV_EXAMPLE]) {
    for (const m of text.matchAll(/\b(SJ_[A-Z0-9_]+)\b/g)) names.add(m[1]!)
  }
  return [...names].sort()
}

/** Named on a line of compose.yaml's `environment:` — as `NAME: …`, `- NAME=…` or a bare
 *  `- NAME` pass-through. */
const passedThrough = (name: string): boolean =>
  COMPOSE.split('\n').some((l) => new RegExp(`^\\s*-?\\s*${name}\\s*(=|:|$)`).test(l))

describe('★ every knob the docs promise reaches the container', () => {
  it('is reading the table it thinks it is', () => {
    const knobs = documentedKnobs()
    expect(knobs.length).toBeGreaterThan(6)
    expect(knobs).toContain('SJ_LIVE')
    expect(knobs).toContain('SJ_LAMPS')
    expect(knobs).not.toContain('SJ_BUILDERS')   // `dev:world` only, per the table itself
  })

  it('passes every documented SJ_* knob through compose.yaml', () => {
    const missing = documentedKnobs().filter((n) => !passedThrough(n))
    expect(missing, `documented as a .env toggle, never passed to a container: ${missing.join(', ')}`)
      .toEqual([])
  })

  it('passes the live key too, which is what SJ_LIVE=1 spends', () => {
    expect(ENV_EXAMPLE).toContain('OPENROUTER_API_KEY')
    expect(passedThrough('OPENROUTER_API_KEY')).toBe(true)
  })

  /** The one knob that must NOT follow `.env`: a stray `SJ_FRESH=1` left over from a reset
   *  would delete the world on every restart. See deploy/README.md. */
  it('pins SJ_FRESH to 0 rather than passing it through', () => {
    const settings = COMPOSE.split('\n').filter((l) => !/^\s*#/.test(l))
    expect(settings.some((l) => /SJ_FRESH\s*[:=]\s*"?0"?\s*$/.test(l))).toBe(true)
    expect(settings.filter((l) => l.includes('SJ_FRESH')).join('\n')).not.toContain('${')
  })
})
