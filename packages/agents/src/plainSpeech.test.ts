import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { perceptionToProse, type PerceptionPacket } from './prompt/prose.js'
import { quietMeadowPacket } from './testutil/fixtures.js'

// The plain speech ruling made mechanical: no semicolon and no dash in a line a person or a mind
// reads. Prompts are authored strings, so the guard reads the authored strings themselves.

const BANNED = /[;—–]/u

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(dir, f))
}

// The prompt surface this guard owns. Not yet walked, and still carrying marks a mind reads:
// 22 refusal strings under packages/engine/src/verbs and 18 prompt strings under packages/arbiter/src.
const SOURCES = [
  ...sourcesUnder(join(ROOT, 'packages/agents/src')),
  ...sourcesUnder(join(ROOT, 'packages/shared/src')),
  join(ROOT, 'packages/narrator/src/chronicle.ts'),
]

// The two exemptions, both shapes rather than rosters. A SQL statement ends in a semicolon and a
// character class holds every mark it matches, and neither is ever said to anybody.
const SQL = /CREATE (?:TABLE|INDEX|TRIGGER)/u

function insideARegExp(node: ts.Node): boolean {
  let up = node.parent
  while (ts.isTemplateSpan(up) || ts.isTemplateExpression(up)) up = up.parent
  return ts.isNewExpression(up) && up.expression.getText() === 'RegExp'
}

function markedStringsIn(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const said = node.getText(source)
      if (BANNED.test(said) && !SQL.test(said) && !insideARegExp(node)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        found.push(`${relative(ROOT, file)}:${line} ${said.replace(/\n/gu, ' ').slice(0, 110)}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('★ every authored line in agents and shared sounds like somebody talking', () => {
  it('carries no semicolon and no dash in any authored string', () => {
    expect(SOURCES.length).toBeGreaterThan(70)
    expect(SOURCES.flatMap(markedStringsIn)).toEqual([])
  })

  // The scan reads what is written. This reads what comes out, because the marks that used to
  // reach a mind were joiners: a claim, a mark and a doorway pushed together into one sentence.
  it('and the perception a mind is handed is still clean once the pieces are joined', () => {
    const rich: PerceptionPacket = {
      ...quietMeadowPacket,
      self: {
        ...quietMeadowPacket.self,
        inventory: [
          {
            id: 'item_2',
            kind: 'note',
            qty: 1,
            text: 'bring the rope',
            ownerName: 'Nadia',
            spoiling: true,
            marks: { promised: 'to Omar' },
            loc: { t: 'agent', id: 'tamar' },
          },
        ],
      },
      reach: { atHand: [], noFooting: [] },
      visible: {
        agents: [
          {
            id: 'omar',
            name: 'Omar',
            x: 13,
            y: 9,
            activityVerb: null,
            collapsed: false,
            asleep: false,
            marks: { debt: 'two planks' },
          },
        ],
        structures: [
          {
            id: 'structure_1',
            kind: 'cottage',
            x: 14,
            y: 9,
            w: 2,
            h: 2,
            burning: false,
            stage: 'complete',
            door: { x: 14, y: 10 },
            hearth: 'lit',
            bed: true,
            marks: { keeper: 'Omar' },
          },
        ],
        items: [
          {
            id: 'item_1',
            kind: 'bread',
            qty: 1,
            loc: { t: 'tile', x: 12, y: 10 },
            ownerName: 'Nadia',
            crafterMarkName: 'Rahel',
            spoiling: true,
          },
        ],
        crops: [],
      },
    }
    const said = perceptionToProse(rich)
    expect(said).toContain('marked: keeper Omar')
    expect(said).toContain("Nadia's")
    expect(said).not.toMatch(BANNED)
  })
})
