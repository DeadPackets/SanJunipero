import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { doorTile, makeCityTemplate } from '@sj/shared'
import { devTown } from './devTown.js'
import { FOUNDERS, foundersFor, townStructuresFor } from './founders.js'

// GATE G12c — THE TOWN, U25, AND THE READ-ONLY PROOF. The other two files are:
//   packages/web/src/render/g12c.test.ts   — the canvas (U3–U11, U18, U19)
//   packages/web/src/ui/g12c.test.ts       — the chrome (U12–U17, U20–U24, P22)
//
// This half lives in the gateway for the D-41 reason: `@sj/web` is private, DOM-typed and
// bundler-resolved, so a gateway test cannot import its modules without breaking `tsc -b`.

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')

// ── U3 · the town the viewer actually sees is the town the template describes ─────────────

describe('U3 — the dev showcase is the REAL town, not a four-building stub', () => {
  const town = devTown()

  it('stands all eleven, where the screenshot showed four', () => {
    expect(town.structures).toHaveLength(11)
    expect(townStructuresFor('showcase')).toHaveLength(11)
  })

  it('derives the ground and the buildings from ONE call, so they cannot disagree', () => {
    const src = readFileSync(join(HERE, 'devTown.ts'), 'utf8')
    expect(src).toContain('makeCityTemplate')
    expect(src).toContain('the SAME anchor')
  })

  it('gives the five houses five different owners', () => {
    const houses = town.structures.filter((s) => s.kind === 'house')
    expect(houses).toHaveLength(5)
    const owners = houses.map((h) => h.owner)
    expect(owners.filter((o) => o !== null)).toHaveLength(5)
    expect(new Set(owners).size).toBe(5)
  })
})

// ── U25 · five people, five roofs ─────────────────────────────────────────────────────────

describe('U25 — "all of the humans were sleeping inside of one house"', () => {
  const town = devTown()

  it('gives every founder a home of their own, by the ownership law', () => {
    const founders = foundersFor(town.structures)
    expect(founders.length).toBeGreaterThanOrEqual(5)
    const homes = founders
      .map((f) => town.structures.find((s) => s.kind === 'house' && s.owner === f.id)?.id)
      .filter((id): id is string => id !== undefined)
    expect(homes).toHaveLength(5)
    expect(new Set(homes).size, 'two founders share a roof').toBe(5)
  })

  it('puts each owner\'s door on their OWN house, never on a shared one', () => {
    const t = makeCityTemplate({ x: 0, y: 9 })
    const doors = t.structures.filter((s) => s.kind === 'house').map((s) => {
      const d = doorTile(s)
      return `${d.dx},${d.dy}`
    })
    expect(new Set(doors).size).toBe(doors.length)
  })

  it('names the FIVE founders the town is seeded with', () => {
    expect(FOUNDERS).toHaveLength(5)
    expect(new Set(FOUNDERS.map((f) => f.id)).size).toBe(5)
  })

  // The full five-distinct-`insideId` simulation is `founders.test.ts`'s
  // "puts five tired founders under five different roofs" — it drives 400 ticks of the real
  // onTick with every founder kept spent. This gate asserts the OWNERSHIP LAW that test
  // depends on, and names the engine half's citation rather than reproducing it.
  it('has the engine half written down, with its citation', () => {
    const delta = readFileSync(join(REPO, 'docs', 'superpowers', 'plans', 'c8-delta-from-c12.md'), 'utf8')
    expect(delta).toMatch(/U25/)
  })
})

// ── the read-only proof ───────────────────────────────────────────────────────────────────

const GOLDEN_G1 = 'f487a26bd9dfba5d6d0d04f41b57f8e85dc9afe7f9ae1caf608de8c182effeac'
// C11's Task 37b regenerated G2 after this branch forked; the older value is not a competing
// decision, so the merge re-pins it to main's.
// Re-pinned again by the `hut` → `house` rename lane (previous: c1c51b42…), whose scripted
// fixture builds a dwelling and therefore carries the kind string into the state hash.
const GOLDEN_G2 = '00d724345c37104d6c93f10398b96eded080b58db78108746e2a037fce836a10'

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()
/** the raw bytes, for a comparison where a trailing newline is part of the file */
const gitBytes = (...args: string[]): Buffer =>
  execFileSync('git', args, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })

// The config hash. `structures.enterableKinds` and `sleepableKinds` live inside it, which is
// why retiring the `hut` id had to be its own authorized cross-lane act rather than a layout
// tweak. Moved again by the world-growth lane's authorized deletion of `mapGrowth.maxSize` and
// the two dials that served it — a ceiling has no place in a grammar that plats rings forever.
// Previous: 02f295ad… (hut → house), a90bd747… (C11 Task 37b).
const FORGE_CONFIG_HASH = 'da065752366c812c531b1eaa0f8537781bc6f5859e5a4bf6647aa5edc37cd472'
const BLOCK1_SHA256 = '4205d892c18a91de4c9c3a50f0122abaad0d6170488455419dc045bfc4d50065'

// ★ THE LIVE ASSIGNMENT, NOT THE FILE. `toContain` was satisfied by any occurrence of the
// hash, and every one of these files keeps its superseded values in a "Previous value:"
// comment — so reverting a pin to a value the file still mentions passed the guard. Each row
// now reads the hash out of the statement that DECIDES it, and the row below plants a wrong
// value to prove the extraction bites.
const pinAt = (rx: RegExp, ...p: string[]): string | null =>
  rx.exec(readFileSync(join(REPO, ...p), 'utf8'))?.[1] ?? null

const G1_AT = ['packages', 'engine', 'src', 'golden.test.ts'] as const
const G2_AT = ['packages', 'engine', 'src', 'g2.test.ts'] as const
const FORGE_AT = ['packages', 'forge', 'src', 'forgeConfig.test.ts'] as const
const BLOCK1_AT = ['packages', 'agents', 'src', 'prompt', 'rulesOfBeing.test.ts'] as const
const G1_RX = /const GOLDEN_DAY_HASH = '([0-9a-f]{64})'/
const G2_RX = /const GOLDEN_G2_HASH = '([0-9a-f]{64})'/
const FORGE_RX = /stateHash\(DEFAULT_CONFIG\)\)\.toBe\(\s*'([0-9a-f]{64})'/
const BLOCK1_RX = /const BLOCK1_SHA256 = '([0-9a-f]{64})'/

describe('G12c read-only proof — the four pins are where they were', () => {
  it('leaves all four pins exactly where they were', () => {
    expect(pinAt(G1_RX, ...G1_AT), 'G1 pin moved').toBe(GOLDEN_G1)
    expect(pinAt(G2_RX, ...G2_AT), 'G2 pin moved').toBe(GOLDEN_G2)
    expect(pinAt(FORGE_RX, ...FORGE_AT), 'forge config pin moved').toBe(FORGE_CONFIG_HASH)
    expect(pinAt(BLOCK1_RX, ...BLOCK1_AT), 'BLOCK1 pin moved').toBe(BLOCK1_SHA256)
  })

  // Not vacuous, twice over: each pattern must find a hash at all (a renamed constant would
  // otherwise read as `null` on both sides of nothing), and it must read the live one rather
  // than a superseded value the same file still carries in a comment.
  it('reads the live assignment, not a superseded value the file still mentions', () => {
    for (const [rx, at] of [[G1_RX, G1_AT], [G2_RX, G2_AT], [FORGE_RX, FORGE_AT],
      [BLOCK1_RX, BLOCK1_AT]] as const) {
      expect(pinAt(rx, ...at), `${at.at(-1)} has no pin the pattern can find`).toMatch(/^[0-9a-f]{64}$/)
    }
    const g2 = readFileSync(join(REPO, ...G2_AT), 'utf8')
    const superseded = '665a824948155304d7dcc1131e821e89299dd73d6cb5c976287955edc5a5fa11'
    expect(g2, 'g2.test.ts no longer records its superseded pin — pick another').toContain(superseded)
    expect(pinAt(G2_RX, ...G2_AT), 'the guard read a comment instead of the assignment')
      .not.toBe(superseded)
  })

  // ★ AGAINST THE MERGE BASE, NOT AGAINST MAIN'S TIP. `main` has moved on since this branch
  // forked — its `g2.test.ts` is 122 lines shorter — and a branch cannot be blamed for a file
  // somebody else edited. The claim this gate makes is "THIS BRANCH did not touch the
  // goldens", and the merge base is the only commit that states it.
  //
  // G2 LEFT THIS CLAUSE, G1 DID NOT. G2 hashes a world the fixture builds, so any authorized
  // change to what stands in that world moves it — the `hut` → `house` rename did, and the
  // freeze would have made the rename unlandable while proving nothing the literal pin above
  // does not already prove. G1 is the replay proof: `TickLoop` folds handed-in events and runs
  // no world system, so nothing legitimate reaches it and a byte freeze is the right claim.
  it('has the G1 golden file byte-identical to the commit this branch forked from', () => {
    const base = git('merge-base', 'main', 'HEAD')
    const p = 'packages/engine/src/golden.test.ts'
    const here = createHash('sha256').update(readFileSync(join(REPO, p))).digest('hex')
    const atBase = createHash('sha256').update(gitBytes('show', `${base}:${p}`)).digest('hex')
    expect(here, `${p} moved on this branch`).toBe(atBase)
  })

  // Not vacuous: the comparison finds a difference when there is one to find.
  it('sees a byte change in the G1 golden when one is planted', () => {
    const base = git('merge-base', 'main', 'HEAD')
    const p = 'packages/engine/src/golden.test.ts'
    const tampered = createHash('sha256')
      .update(Buffer.concat([readFileSync(join(REPO, p)), Buffer.from('\n')])).digest('hex')
    const atBase = createHash('sha256').update(gitBytes('show', `${base}:${p}`)).digest('hex')
    expect(tampered).not.toBe(atBase)
  })

  // DELIBERATELY NOT RESTORED: two branch-scoped clauses used to live here — "touched nothing
  // under engine, arbiter, agents or forge since main" and a freeze on `cityTemplate.ts` from
  // batch 6's base. Both were true statements about C12a while C12a was an unmerged branch.
  // C12a has merged, so `main...HEAD` no longer means "this chunk's diff": it means "whatever
  // the current branch is", and the clauses fired on every later branch that legitimately
  // touched another package — including the lane whose whole job was to re-author
  // `cityTemplate.ts`. The pin guard above is the permanent protection and it stays.
})
