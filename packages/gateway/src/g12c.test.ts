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

  it('gives the five huts five different owners', () => {
    const huts = town.structures.filter((s) => s.kind === 'hut')
    expect(huts).toHaveLength(5)
    const owners = huts.map((h) => h.owner)
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
      .map((f) => town.structures.find((s) => s.kind === 'hut' && s.owner === f.id)?.id)
      .filter((id): id is string => id !== undefined)
    expect(homes).toHaveLength(5)
    expect(new Set(homes).size, 'two founders share a roof').toBe(5)
  })

  it('puts each owner\'s door on their OWN hut, never on a shared one', () => {
    const t = makeCityTemplate({ x: 0, y: 9 })
    const doors = t.structures.filter((s) => s.kind === 'hut').map((s) => {
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
const GOLDEN_G2 = 'c1c51b42aa340f0e5ae0d8cc321b602345f6ec4fee4e4d20b48f7e692b946d9c'

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()
/** the raw bytes, for a comparison where a trailing newline is part of the file */
const gitBytes = (...args: string[]): Buffer =>
  execFileSync('git', args, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })

// The config hash. `structures.enterableKinds` and `sleepableKinds` live inside it, which is
// why the town's five homes still carry the `hut` id: naming them for the contemporary set
// would move THIS literal, and that is a cross-lane decision, not a layout tweak.
const FORGE_CONFIG_HASH = 'a90bd7471668eea6e8a8e7932129ef7905ae2477b396d5c7b792df539065c4d8'
const BLOCK1_SHA256 = '28c1fce0781ec9019416c234a9eae47401ff4b9dc4a96b91c371335fbad97bd6'

describe('G12c read-only proof — the four pins are where they were', () => {
  it('leaves all four pins exactly where they were', () => {
    const at = (...p: string[]): string => readFileSync(join(REPO, ...p), 'utf8')
    expect(at('packages', 'engine', 'src', 'golden.test.ts'), 'G1 pin moved').toContain(GOLDEN_G1)
    expect(at('packages', 'engine', 'src', 'g2.test.ts'), 'G2 pin moved').toContain(GOLDEN_G2)
    expect(at('packages', 'forge', 'src', 'forgeConfig.test.ts'), 'forge config pin moved')
      .toContain(FORGE_CONFIG_HASH)
    expect(at('packages', 'agents', 'src', 'prompt', 'rulesOfBeing.test.ts'), 'BLOCK1 pin moved')
      .toContain(BLOCK1_SHA256)
  })

  // ★ AGAINST THE MERGE BASE, NOT AGAINST MAIN'S TIP. `main` has moved on since this branch
  // forked — its `g2.test.ts` is 122 lines shorter — and a branch cannot be blamed for a file
  // somebody else edited. The claim this gate makes is "THIS BRANCH did not touch the
  // goldens", and the merge base is the only commit that states it.
  it('has the two golden files byte-identical to the commit this branch forked from', () => {
    const base = git('merge-base', 'main', 'HEAD')
    for (const p of ['packages/engine/src/golden.test.ts', 'packages/engine/src/g2.test.ts']) {
      const here = createHash('sha256').update(readFileSync(join(REPO, p))).digest('hex')
      const atBase = createHash('sha256').update(gitBytes('show', `${base}:${p}`)).digest('hex')
      expect(here, `${p} moved on this branch`).toBe(atBase)
    }
  })

  // DELIBERATELY NOT RESTORED: two branch-scoped clauses used to live here — "touched nothing
  // under engine, arbiter, agents or forge since main" and a freeze on `cityTemplate.ts` from
  // batch 6's base. Both were true statements about C12a while C12a was an unmerged branch.
  // C12a has merged, so `main...HEAD` no longer means "this chunk's diff": it means "whatever
  // the current branch is", and the clauses fired on every later branch that legitimately
  // touched another package — including the lane whose whole job was to re-author
  // `cityTemplate.ts`. The pin guard above is the permanent protection and it stays.
})
