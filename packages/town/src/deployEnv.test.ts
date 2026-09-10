// A knob documented as a `.env` toggle that `compose.yaml` never passes through is one an
// operator can set, read back in the docs, and watch do nothing.
import { readdirSync, readFileSync } from 'node:fs'
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

/** The other direction: a knob the code reads that compose never passes is one an operator can
 *  set in `.env` and watch do nothing — and no doc row exists to trip the check above. */
function knobsTheCodeReads(): string[] {
  const names = new Set<string>()
  const walk = (dir: URL): void => {
    for (const e of readdirSync(fileURLToPath(dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, dir))
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        for (const line of readFileSync(fileURLToPath(new URL(e.name, dir)), 'utf8').split('\n')) {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
          for (const m of line.matchAll(/\bSJ_[A-Z0-9_]+\b/g)) names.add(m[0])
        }
      }
    }
  }
  for (const pkg of readdirSync(fileURLToPath(new URL('packages/', REPO)))) {
    walk(new URL(`packages/${pkg}/src/`, REPO))
  }
  return [...names].sort()
}

/** Only the town runs the code. A knob listed under `caddy:` or `litestream:` never reaches it. */
const TOWN_SERVICE = COMPOSE.split(/\n {2}(?=[a-z])/).find((s) => s.startsWith('town:')) ?? ''

const passedThrough = (name: string, block: string = COMPOSE): boolean =>
  block.split('\n').some((l) => new RegExp(`^\\s*-?\\s*${name}\\s*(=|:|$)`).test(l))

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

// The script that spends real money is also the one that publishes a log tail: a five-second
// grace re-enters a teardown still draining, and "grep -v key" is not a redaction.
describe('★ a rehearsal ends the way the container does, and publishes no secret', () => {
  const SH = read('scripts/rehearse.sh')

  it('gives the town the same grace compose gives the container', () => {
    expect(COMPOSE).toContain('stop_grace_period: 20s')
    expect(SH, 'a second signal five seconds in').not.toContain('sleep 5; kill')
    expect(SH).toContain('for i in $(seq 1 20); do sleep 1; kill -0 $PID')
  })

  it('redacts by the shape of a secret, not by the word "key"', () => {
    expect(SH).not.toContain('grep -v -i "key"')
    expect(SH).toContain('s/sk-[A-Za-z0-9._-]{6,}/[redacted]/g')
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

  // ★ The direction the docs cannot cover: SJ_IDLE_GAP, the dial every live call scales with,
  // was read by the runtime and named in no doc and no compose row, so it could not be set at all.
  it('★ passes every SJ_* knob the code reads, documented or not', () => {
    const read = knobsTheCodeReads()
    expect(read).toContain('SJ_IDLE_GAP')
    // A knob from a second package, so the walk is proved to reach past `packages/town`.
    expect(read).toContain('SJ_MIND_ROUTE')
    const missing = read.filter((n) => !passedThrough(n, TOWN_SERVICE))
    expect(missing, `read by the code, never passed to the town: ${missing.join(', ')}`).toEqual([])
  })

  it('passes the live key too, which is what SJ_LIVE=1 spends', () => {
    expect(ENV_EXAMPLE).toContain('OPENROUTER_API_KEY')
    expect(passedThrough('OPENROUTER_API_KEY', TOWN_SERVICE)).toBe(true)
  })

  /** The one knob that must NOT follow `.env`: a stray `SJ_FRESH=1` left over from a reset
   *  would delete the world on every restart. */
  it('pins SJ_FRESH to 0 rather than passing it through', () => {
    const settings = COMPOSE.split('\n').filter((l) => !/^\s*#/.test(l))
    expect(settings.some((l) => /SJ_FRESH\s*[:=]\s*"?0"?\s*$/.test(l))).toBe(true)
    expect(settings.filter((l) => l.includes('SJ_FRESH')).join('\n')).not.toContain('${')
  })
})
