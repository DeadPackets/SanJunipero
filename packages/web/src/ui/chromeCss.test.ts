import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// ★ THE STRUCTURAL GUARD ON chrome.css. Every UI lane appends a block to this sheet and every
// merge train has resolved it by hand, counting braces in a terminal. A union merge that drops
// one side's block is invisible to tsc and to every other test in the suite — the remaining CSS
// still parses, still builds, and the surface it styled just stops being styled. Merge train 1
// caught a real off-by-one that way and asked for this file: it turns the integrator's
// arithmetic into something `pnpm test` does.

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'chrome.css'), 'utf8')
const LINES = CSS.split('\n')

/** A section banner opens every block in the sheet. Read off the file rather than transcribed,
 *  so the guard covers sections nobody thought to list. */
const BANNERS = LINES.filter((l) => /^\/\* [──══]/u.test(l))

/** The two blocks a merge train actually risks, named so a failure says whose block went. */
const LANE_BLOCKS: ReadonlyArray<readonly [lane: string, banner: string]> = [
  ['the Discovery Record', '/* ── the Discovery Record: a chain of museum labels'],
  ['THE LITTLE MAP', '/* ══ ★ THE LITTLE MAP ═'],
]

describe('★ chrome.css survives the merge trains intact', () => {
  it('opens each section exactly once', () => {
    const seen = new Map<string, number>()
    for (const b of BANNERS) seen.set(b, (seen.get(b) ?? 0) + 1)
    expect([...seen].filter(([, n]) => n > 1), 'a section banner appears twice').toEqual([])
  })

  // 22 base + 1 the Discovery Record + 1 the little map. A dropped block takes its banner with
  // it, so this is the number that notices; a lane adding one must say so here.
  it('has the 24 sections the trains left it with', () => {
    expect(BANNERS).toHaveLength(24)
  })

  it('carries each lane’s own block exactly once', () => {
    for (const [lane, banner] of LANE_BLOCKS) {
      expect(CSS.split(banner).length - 1, `${lane}: block missing or duplicated`).toBe(1)
    }
  })

  // 167 base + 5 the Discovery Record + 2 the little map — merge train 1's hand count — + 1 the
  // bond tally (`contracts`: the whole-history counts the 24-act window cannot say). Half a
  // block surviving a union merge keeps its banner and still balances its braces; only the rule
  // count sees it.
  it('has the 175 top-level rules the trains counted', () => {
    expect(LINES.filter((l) => l.startsWith('}'))).toHaveLength(175)
  })

  it('is brace-balanced and carries no conflict marker', () => {
    expect(CSS.match(/{/g) ?? []).toHaveLength((CSS.match(/}/g) ?? []).length)
    expect(LINES.filter((l) => /^(<{7}|={7}|>{7}|\|{7})/.test(l)), 'conflict marker in the sheet')
      .toHaveLength(0)
  })
})

// ★ THE CONTROL BAR MAY NOT LOSE A CONTROL, AND THE SHEET IS WHERE THAT IS DECIDED.
//
// Merge train 2 and this lane both photographed it: with a right-hand panel open, the bar was
// 1072 px holding 1435 px of controls, and MOMENTS, WORLD LAWS and HIDE THE CONTROLS were past
// the edge. HIDE THE CONTROLS is the escape hatch; losing it is the worst of the three.
//
// The cause is one word. The bar's ONLY responsive rule was `@media (max-width: 1100px)`, and
// the thing that narrows this bar is not the window — it is a 23rem panel sliding in beside it.
// The window never changed, so the rule never fired.
//
// These assertions are on the SHEET rather than on a model of it, because the sheet is the
// thing that was wrong and a model would have agreed with the model. No layout engine runs in
// vitest; what a test CAN do is refuse the two constructions that made a control unreachable.
describe('★ the control bar keeps every control at every stage width', () => {
  /** The sheet with its comments removed. Everything below asks what the sheet DOES, and a
   *  comment quoting the rule that was wrong must not read as that rule still being there. */
  const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  /**
   * ONE top-level rule, by its own selector line, ending at the first bare `}` — or on the
   * same line when the rule is a one-liner. A regex over the whole sheet reads whatever comes
   * next: the first `.control-bar` in this file is the DOCKED variant a hundred lines above,
   * and a guard that measured that block would have passed on the broken sheet. Twelve vacuous
   * guards on this project began exactly that way.
   */
  const topRule = (selector: string): string => {
    const lines = BARE.split('\n')
    const start = lines.findIndex((l) => l === `${selector} {` || l.startsWith(`${selector} { `))
    if (start < 0) return ''
    if (lines[start]!.trimEnd().endsWith('}')) return lines[start]!
    const end = lines.indexOf('}', start)
    return end < 0 ? '' : lines.slice(start, end + 1).join('\n')
  }
  const barRule = topRule('.control-bar')

  it('wraps instead of cutting: a bar too narrow grows a row, it never loses a button', () => {
    expect(barRule, '.control-bar is not a top-level rule in the sheet').not.toBe('')
    expect(barRule, 'the bar must wrap; overflow is not a way to reach a control')
      .toMatch(/flex-wrap:\s*wrap/)
    // a group that cannot wrap cuts its own buttons out of a bar that can
    expect(topRule('.ctl-group'), '.ctl-group must wrap too').toMatch(/flex-wrap:\s*wrap/)
  })

  it('★ asks about the BAR, not the window — the panel is what narrows it', () => {
    expect(barRule, 'the bar must be a size container for @container to have anything to ask')
      .toMatch(/container-type:\s*inline-size/)
    expect(BARE, 'the label rule must be a container query')
      .toMatch(/@container control-bar \(max-width: 1500px\)/)
    // and the viewport query it replaced must not come back beside it: two rules keyed to two
    // different widths is how the bar came to have full labels in 1072 px of room.
    const viewportLabelRules = BARE.split(/@media[^{]*\(max-width[^{]*\{/)
      .slice(1)
      .filter((chunk) => /\.ctl-label\b/.test(chunk.slice(0, chunk.indexOf('\n}'))))
    expect(viewportLabelRules, 'a viewport media query still hides .ctl-label').toHaveLength(0)
  })

  it('keeps the hit floor the minimap lane measured, in the sheet where it is set', () => {
    const btn = topRule('.ctl-btn')
    expect(btn).toMatch(/min-width:\s*44px/)
    expect(btn).toMatch(/min-height:\s*44px/)
  })

  it('leaves the bar clear of the dock handle pinned to the same corner', () => {
    expect(barRule, 'a control under the 44px handle is as unreachable as one past the edge')
      .toMatch(/padding:\s*0\.3rem 52px 0\.3rem 0\.8rem/)
    // 52 is the handle's own 44 plus the sheet's 8px of air
    expect(topRule('.hud-handle')).toMatch(/width:\s*44px/)
  })

  it('does NOT wrap when the bar is docked to an edge — that makes a second column', () => {
    expect(BARE).toMatch(/data-dock-controls="right"\] \.control-bar \{[\s\S]{0,400}?flex-wrap:\s*nowrap/)
  })
})
