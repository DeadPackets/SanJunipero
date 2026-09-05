import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LawRowSchema, type LawRow, type NameIndex } from '@sj/shared'
import { LAW_FIXTURE } from '@sj/shared/testutil'
import { TOGGLABLE_PATHS } from '@sj/engine/laws'
import { machineWordOffenders } from '../../ui/broadcastReady.js'
import { WorldLawsView } from './Laws.js'

const PEOPLE: NameIndex = {
  nadia: { name: 'Nadia' },
  omar: { name: 'Omar' },
  salma: { name: 'Salma' },
  yusuf: { name: 'Yusuf' },
  amara: { name: 'Amara' },
}

// What `/api/laws` sends for the three prototype councils, parsed by the wire schema so this
// suite cannot drift from the row the gateway builds — and in the order the endpoint sends it.
const EXTRA: Record<string, Partial<LawRow>> = {
  law_slate: { ratifiedTick: 10, breaches: 2 },
  law_fire_tax: { ratifiedTick: 1450, repealedTick: 2000 },
  law_well_order: { ratifiedTick: 2900, breaches: 1 },
}

const rows: LawRow[] = [...LAW_FIXTURE].reverse().map((f) =>
  LawRowSchema.parse({
    id: f.id,
    text: f.text,
    proposedBy: f.proposedBy,
    proposerName: PEOPLE[f.proposedBy]!.name,
    ratifiedTick: 0,
    repealedTick: null,
    votes: f.votes,
    why: f.why,
    enforced: f.predicate.kind !== 'none',
    breaches: 0,
    ...EXTRA[f.id],
  }),
)

const unescape = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const markupOf = (laws: readonly LawRow[]): string =>
  renderToStaticMarkup(createElement(WorldLawsView, { laws, people: PEOPLE }))

const wordsOf = (laws: readonly LawRow[]): string =>
  unescape(markupOf(laws).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

describe('the World tab is the rules the town wrote for itself', () => {
  it('leads with the town’s own sentence, newest first', () => {
    const titles = [...markupOf(rows).matchAll(/class="law-title">“([^”]+)”/g)].map((m) =>
      unescape(m[1]!),
    )
    expect(titles).toEqual([LAW_FIXTURE[2]!.text, LAW_FIXTURE[1]!.text, LAW_FIXTURE[0]!.text])
  })

  it('names who put it, when the room agreed, who stood where, and how often it broke', () => {
    const words = wordsOf(rows)
    // the slate rule: Nadia put it, two stood for it, nobody against, and it broke twice
    expect(words).toContain('Put by Nadia')
    expect(words).toContain('Day 0, 00:10')
    expect(words).toContain('For Nadia, Omar')
    expect(words).toContain('Against nobody')
    expect(words).toContain('Broken twice')
    // the fire tax: Salma alone for it, Yusuf against, and the town let it go the next day
    expect(words).toContain('For Salma')
    expect(words).toContain('Against Yusuf')
    expect(words).toContain('let go')
    expect(words).toContain('Let go on day 1, at 09:20')
    // the well-order: never broken, and the court's reading under a plain label
    expect(words).toContain('Broken never')
    expect(words).toContain(`In practice: ${LAW_FIXTURE[2]!.why}`)
  })

  it('says nothing of a rule the world cannot hold anybody to, except that it cannot', () => {
    const toothless = { ...rows[0]!, enforced: false, repealedTick: null }
    expect(wordsOf([toothless])).toContain('in words only')
    // a standing rule with teeth wears no badge: agreeing on it is supposed to be enough
    expect(wordsOf([{ ...toothless, enforced: true }])).not.toContain('in words only')
  })

  it('★ never prints a physics knob: the operator’s dials are not the town’s laws', () => {
    const markup = markupOf(rows)
    for (const path of Object.keys(TOGGLABLE_PATHS)) expect(markup, path).not.toContain(path)
    expect(markup).not.toMatch(/law_|predicate|ordinal/)
    for (const id of Object.keys(PEOPLE)) expect(markup, id).not.toMatch(new RegExp(`\\b${id}\\b`))
  })

  // R4 moved here from the copy table `lawCopy.ts` used to hold: the words on this page are the
  // town's own, so they are scanned where they are rendered rather than in a table of ours.
  it('★ R4 — no machine word, id or bare number survives the render', () => {
    expect(machineWordOffenders([{ where: 'laws page', text: wordsOf(rows) }])).toEqual([])
  })

  it('renders a town that has agreed nothing as an empty list, not as a lie', () => {
    expect(markupOf([])).toContain('class="laws-list"')
    expect(wordsOf([])).not.toContain('Put by')
  })
})

describe('★ the operator’s physics copy is gone from the viewer', () => {
  const SRC = new URL('../../', import.meta.url).pathname
  // The specifier, not the word: this file names `lawCopy` in its own prose and must not
  // report itself. Importing browserGraph.test.ts for its parser would run that suite twice.
  const IMPORTS_LAW_COPY = /from\s*['"][^'"]*lawCopy[^'"]*['"]/

  const filesUnder = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) return filesUnder(full)
      return /\.tsx?$/.test(name) ? [full] : []
    })

  it('is imported by nothing and shipped in no bundle', () => {
    const offenders = filesUnder(SRC)
      .filter((f) => IMPORTS_LAW_COPY.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length))
    expect(offenders).toEqual([])
  })
})
