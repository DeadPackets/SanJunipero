// A knob documented as a `.env` toggle that `compose.yaml` never passes through is one an
// operator can set, read back in the docs, and watch do nothing.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = new URL('../../../', import.meta.url)
const read = (p: string): string => readFileSync(fileURLToPath(new URL(p, REPO)), 'utf8')

const README = read('README.md')
const DEPLOY_README = read('deploy/README.md')
const ENV_EXAMPLE = read('deploy/.env.example')
const COMPOSE = read('compose.yaml')

/** `dev:world`-only rows would be excluded, but one env parse means there are none left. */
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

const passedThrough = (name: string): boolean =>
  COMPOSE.split('\n').some((l) => new RegExp(`^\\s*-?\\s*${name}\\s*(=|:|$)`).test(l))

/** Properties, not rosters: a named five-founder backup puts every child born in play outside
 *  it, and the failure is invisible until a restore. */
describe('★ the backup covers the minds that exist, not the minds that were planned', () => {
  const SH = read('deploy/litestream.sh')

  it('names no founder, and takes the databases from the volume', () => {
    for (const founder of ['amara', 'yusuf', 'nadia', 'omar', 'salma']) {
      expect(SH, `${founder} is named in the backup config`).not.toContain(founder)
    }
    expect(SH).toContain("find /data -name '*.db'")
  })

  /** litestream 0.3.13 takes `dbs[].path` literally, so a `*.db` entry backs up nothing while
   *  reporting itself healthy — verified against the pinned image. */
  it('does not hand litestream a wildcard path', () => {
    expect(SH).not.toContain('path: /data/minds/*.db')
  })

  it('is the entrypoint compose runs, and nothing else is mounted for it', () => {
    expect(COMPOSE).toContain('./deploy/litestream.sh:/etc/litestream.sh:ro')
    expect(COMPOSE).not.toContain('litestream.yml')
  })
})

describe('★ every knob the docs promise reaches the container', () => {
  it('is reading the table it thinks it is', () => {
    const knobs = documentedKnobs()
    expect(knobs.length).toBeGreaterThan(6)
    expect(knobs).toContain('SJ_LIVE')
    expect(knobs).toContain('SJ_LAMPS')
    // One env parse: a knob a person can set on `dev:world` is a knob the container answers too.
    expect(knobs).toContain('SJ_BUILDERS')
  })

  it('passes every documented SJ_* knob through compose.yaml', () => {
    const missing = documentedKnobs().filter((n) => !passedThrough(n))
    expect(
      missing,
      `documented as a .env toggle, never passed to a container: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('passes the live key too, which is what SJ_LIVE=1 spends', () => {
    expect(ENV_EXAMPLE).toContain('OPENROUTER_API_KEY')
    expect(passedThrough('OPENROUTER_API_KEY')).toBe(true)
  })

  /** The one knob that must NOT follow `.env`: a stray `SJ_FRESH=1` left over from a reset
   *  would delete the world on every restart. */
  it('pins SJ_FRESH to 0 rather than passing it through', () => {
    const settings = COMPOSE.split('\n').filter((l) => !/^\s*#/.test(l))
    expect(settings.some((l) => /SJ_FRESH\s*[:=]\s*"?0"?\s*$/.test(l))).toBe(true)
    expect(settings.filter((l) => l.includes('SJ_FRESH')).join('\n')).not.toContain('${')
  })
})
