import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { mechanicalGate, refusalMessage } from './gate.js'
import { paletteRgb } from './palette.js'

const pal = paletteRgb()
function img(w: number, h: number, fill: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4)
  return { width: w, height: h, data }
}

describe('mechanicalGate', () => {
  it('passes a compliant sprite (palette colors + transparent pixel present)', () => {
    const i = img(2, 2, [...pal[0]!, 255] as [number, number, number, number])
    i.data[3] = 0; i.data[0] = 0; i.data[1] = 0; i.data[2] = 0
    expect(mechanicalGate(i, { w: 2, h: 2, requireAlpha: true })).toEqual({ ok: true, failures: [] })
  })
  it('fails on wrong size', () => {
    const r = mechanicalGate(img(2, 2, [...pal[0]!, 255] as never), { w: 4, h: 4, requireAlpha: false })
    expect(r.ok).toBe(false)
    expect(r.failures.join()).toMatch(/size/)
  })
  it('fails when alpha is required but absent (chroma-key found no background)', () => {
    const r = mechanicalGate(img(2, 2, [...pal[0]!, 255] as never), { w: 2, h: 2, requireAlpha: true })
    expect(r.failures.join()).toMatch(/alpha/)
  })
  it('fails on any off-palette opaque pixel', () => {
    const r = mechanicalGate(img(1, 1, [1, 2, 3, 255]), { w: 1, h: 1, requireAlpha: false })
    expect(r.failures.join()).toMatch(/palette/)
  })
})

// ── ★ THE RULING: A GATE'S VERDICT MAY NOT BE DISCARDED BY ITS CALLER ─────────────────────
//
// `gen-cast-v5.bestOf` shipped the least-bad of three FAILING candidates, and that is how
// `amara/contact-b-ne` — a figure in the wrong costume with TACTICAL GEAR written beside her,
// measured at 1.1855 against a 1.18 tolerance — reached the running product. The same policy
// is written three different ways across the three generators, which is why it was never seen
// as one policy. This is the shared shape, tested here so it is not another unexercised
// script: the generators are live-spend and no test can run them.

describe('refusalMessage — choosing is not deciding', () => {
  const cand = (key: string, ...failures: string[]) => ({ key, failures })

  it('says nothing when ANY candidate is clean — the run goes on', () => {
    expect(refusalMessage('amara se/contact-b', [
      cand('c0', 'silhouette: 1.24 against 1.18'),
      cand('c1'),
      cand('c2', 'palette: 0.69 against 0.80'),
    ])).toBe('')
  })

  it('says nothing when there is nothing to judge', () => {
    expect(refusalMessage('amara se/contact-b', [])).toBe('')
  })

  it('★ refuses when EVERY candidate has a failure, however small', () => {
    const msg = refusalMessage('amara ne/contact-b', [
      cand('walk-amara-ne-contact-b-c0', 'silhouette: 1.1855 against 1.1800 (off by 0.0055)'),
      cand('walk-amara-ne-contact-b-c1', 'silhouette: 1.2400 against 1.1800 (off by 0.0600)'),
      cand('walk-amara-ne-contact-b-c2', 'palette: 0.7100 against 0.8000 (off by 0.0900)'),
    ])
    expect(msg).not.toBe('')
    expect(msg).toContain('all 3 candidates FAILED')
    expect(msg).toContain('amara ne/contact-b')
  })

  // ★ THE PROPERTY, not the wording. An operator cannot tell a threshold that is 0.5 % too
  // tight from a model that cannot draw the thing unless EVERY candidate's margins are in
  // front of them, so every candidate and every failure has to survive into the message.
  it('★ carries every candidate and every failure into the message', () => {
    const cands = [
      cand('c0', 'silhouette: 1.1855 against 1.1800', 'head: 0.24 against 0.20'),
      cand('c1', 'palette: 0.7100 against 0.8000'),
    ]
    const msg = refusalMessage('salma ne/contact-a', cands)
    for (const c of cands) {
      expect(msg, `${c.key} is not named`).toContain(c.key)
      for (const f of c.failures) expect(msg, `"${f}" was dropped`).toContain(f)
    }
  })

  it('the one-candidate case reads as one, not as "1 candidates"', () => {
    expect(refusalMessage('amara se/stride-trio', [cand('trio', 'stride: 0.0000 against 0.1085')]))
      .toContain('all 1 candidate FAILED')
  })
})

// ★ AND THE POLICY IS ACTUALLY WIRED INTO THE LIVE GENERATOR. `gen-cast-v5.ts` is a
// live-spend script; no test can run it, so the only available check is that the decision
// points still go through the refusal and that the discarded-verdict shapes are gone.
describe('gen-cast-v5 ships nothing that failed a gate', () => {
  const src = readFileSync(new URL('../scripts/gen-cast-v5.ts', import.meta.url), 'utf8')

  it('refuses at every point where a candidate is chosen', () => {
    for (const what of ['/${p}`', 'stride-trio', '${m.id} sleep'])
      expect(src, `no refusal beside ${what}`).toContain(what)
    // walk frames, the stride trio, the sleep cell — three decision points, three refusals
    expect(src.match(/refuseFailing\(/g) ?? []).toHaveLength(4) // 1 definition + 3 call sites
  })

  it('★ the stride trio and the atlas pixel bar are no longer advisory', () => {
    expect(src, 'the stride trio still just logs FLAGGED').not.toContain("'FLAGGED'")
    expect(src, 'the packed atlas is still written whatever the bar says')
      .toMatch(/if \(bar\.length > 0\) throw new Error/)
  })

  it('reads the attempt knob its own header has documented since v4', () => {
    expect(src).toContain("process.env['CAST_ATTEMPTS']")
    expect(src, 'a hard-coded attempt count is left somewhere').not.toMatch(/for \(let i = 0; i < 3; i\+\+\)/)
  })
})

// ── ★ AND IN EVERY OTHER GENERATOR, WHICH IS SIX AND NOT THREE ────────────────────────────
//
// The audit that found the policy named three generators. There are SEVEN — the same policy
// pasted between siblings, so a count by disguise undercounts it:
//
//   bestOf, least-bad reduce      gen-cast-v5 (fixed first), gen-cast-v4, gen-character-v4
//   (clean.length ? clean : ...)  gen-structures-v5, gen-dwellings-v2, gen-dwellings
//   rank = fails * 100 + ...      gen-library-v2
//
// `gen-dwellings-v2` is the one that matters most and was not on the list: it is live, it
// writes `content/buildings`, and it wrote the ten dwelling cells the town stands on today.
//
// THESE ARE FILE-CONTENT ASSERTIONS BECAUSE NO TEST CAN RUN A LIVE-SPEND SCRIPT. That makes
// the LAST test here the load-bearing one: it scans the whole scripts directory for the
// policy's shapes rather than for a list of filenames, so the eighth copy somebody pastes
// tomorrow reds without anyone remembering to add it here.
describe('★ no generator in the package ships a candidate that failed a gate', () => {
  const scriptsDir = fileURLToPath(new URL('../scripts', import.meta.url))
  // ★ CODE ONLY. Every one of these files now carries a comment QUOTING the shape it used to
  // have — that is the point of the comment — so a scan that reads the prose reds on the
  // explanation of the fix. Whole-line comments come out first; the shapes below all live on
  // a line of their own.
  const read = (f: string): string => readFileSync(join(scriptsDir, f), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  const GENERATORS = [
    'gen-cast-v5.ts', 'gen-structures-v5.ts', 'gen-dwellings-v2.ts', 'gen-dwellings.ts',
    'gen-library-v2.ts', 'gen-cast-v4.ts', 'gen-character-v4.ts',
  ] as const

  it.each(GENERATORS)('%s goes through the ONE shared refusal in src/gate.ts', (file) => {
    const s = read(file)
    expect(s, 'does not import the shared shape').toContain("from '../src/gate.js'")
    expect(s, 'imports it and never calls it').toMatch(/refusalMessage\(/)
  })

  it.each(['gen-structures-v5.ts', 'gen-dwellings-v2.ts', 'gen-dwellings.ts'] as const)(
    '%s picks from the clean set, not from the dirty one', (file) => {
      const s = read(file)
      expect(s, 'still falls back to the dirty candidate set').not.toMatch(/clean\.length \? clean/)
      expect(s, 'no longer filters to the clean candidates at all').toMatch(/const clean = cands\.filter/)
    })

  it('★ gen-library-v2 EXCLUDES a failure instead of pricing it into a rank', () => {
    const s = read('gen-library-v2.ts')
    expect(s, 'a failed pixel bar is still only worth 100 rank points')
      .not.toMatch(/fails\.length \* 100/)
    expect(s, "the judge's rejection is still only worth 10 rank points").not.toMatch(/\? 0 : 10/)
    // The judge is a gate too — it is the only one in the package that can tell a pail from a
    // market stall, and it was never allowed to disqualify anything.
    expect(s, 'the judge verdict is not part of what makes a candidate clean').toMatch(/judgeFails/)
    expect(s).toMatch(/const clean = cands\.filter/)
  })

  it.each(['gen-cast-v4.ts', 'gen-character-v4.ts'] as const)(
    '%s refuses at all three decision points, superseded or not', (file) => {
      const s = read(file)
      // walk frames, the stride trio, the sleep cell — 1 definition + 3 call sites
      expect(s.match(/refuseFailing\(/g) ?? [], 'a decision point has no refusal beside it')
        .toHaveLength(4)
      expect(s, 'the stride trio is still advisory').toMatch(/stride-trio/)
    })

  // ★ THE ANTI-VACUITY TEST, and the only one here that can catch a generator nobody listed.
  it('★ and no script in the package brings the policy back, in any of its three disguises', () => {
    const offenders: string[] = []
    for (const f of readdirSync(scriptsDir).filter((n) => n.endsWith('.ts')).sort()) {
      const s = read(f)
      if (/clean\.length \? clean/.test(s))
        offenders.push(`${f}: falls back to the DIRTY candidate set when nothing is clean`)
      if (/fails\.length \* 100/.test(s))
        offenders.push(`${f}: RANKS a failure instead of excluding it`)
      // the least-bad reduce is legal — CHOOSING is not deciding — but only beside a refusal
      if (/failures\.length < a\.failures\.length/.test(s) && !/refuseFailing\(/.test(s))
        offenders.push(`${f}: picks the least-bad candidate and never refuses one`)
    }
    expect(offenders, 'a generator ships a candidate its own gate failed').toEqual([])
  })
})
