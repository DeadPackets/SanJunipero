import { readFileSync } from 'node:fs'
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
