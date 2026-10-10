import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const chrome = read('./chrome.css'),
  harmony = read('./harmony.css'),
  almanac = read('./almanac.css'),
  interior = read('./interiors.css'),
  game = read('../paper/game/game.css')
const sheets = [
  chrome,
  harmony,
  almanac,
  interior,
  game,
  read('./corner-controls.css'),
  read('./resident-tokens.css'),
  read('../render/conversationPresence.css'),
  read('../stage/usage-meter.css'),
]
const variables = new Map<string, number>()
for (const match of read('./stacking.css').matchAll(/(--layer-[\w-]+):\s*(\d+)/g))
  variables.set(match[1]!, Number(match[2]))
function z(css: string, selector: string) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const values = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1]?.trim() === selector)
    .flatMap((match) => [...match[2]!.matchAll(/z-index:\s*([^;}]+)/g)])
  const value = values.at(-1)?.[1]?.trim()
  if (value === undefined) throw new Error(`No layer assigned to ${selector}`)
  const variable = /var\((--layer-[\w-]+)\)/.exec(value)?.[1]
  return variable ? (variables.get(variable) ?? NaN) : Number(value)
}
it('places selected person actions above speech, and below navigation', () => {
  const actions = z(chrome, '.stage-ring')
  expect(actions).toBeGreaterThan(z(harmony, '.pixel-speech-layer'))
  expect(actions).toBeLessThan(z(chrome, '.day-bar'))
})
it('keeps both replay effects below world labels and controls', () => {
  for (const effect of ['.replay-grade', '.replay-dip']) {
    expect(z(chrome, effect)).toBeLessThan(z(harmony, '.building-hover-label'))
    expect(z(chrome, effect)).toBeLessThan(z(harmony, '.control-pod'))
  }
})
it('keeps hover labels beneath the almanac and room header', () => {
  expect(z(harmony, '.person-hover-label')).toBeLessThan(z(chrome, '.day-bar'))
  expect(z(harmony, '.person-hover-label')).toBeLessThan(z(interior, '.interior-hud'))
})
it('raises the whole almanac for usage, not just a trapped child', () => {
  expect(almanac).toMatch(/\.almanac:has\([^{}]*\.usage-meter\[open\][^{}]*\)\s*\{[^}]*z-index:/)
})
it('keeps the mobile journal above non-modal popovers and below help', () => {
  const mobile = z(game, '.paper.sj-paper[data-dock=on]')
  expect(mobile).toBeGreaterThan(variables.get('--layer-popover') ?? 35)
  expect(mobile).toBeLessThan(z(chrome, '.key-map'))
})
it('names every page-level priority instead of escalating isolated numbers', () => {
  const local = new Set([
    '.mark-tip',
    '.keepsake-emblem .sj-icon',
    '.almanac-card',
    '.interior-contents',
    '.usage-meter-paper',
  ])
  for (const css of sheets)
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      const value = /z-index:\s*([^;}]+)/.exec(match[2]!)?.[1]?.trim()
      if (value && !local.has(selector)) expect(value, selector).toMatch(/^var\(--layer-/)
    }
})

it('keeps panels and open disclosures above unsolicited achievements', () => {
  const notice = z(harmony, '.keepsake')
  expect(z(chrome, '.paper')).toBeGreaterThan(notice)
  expect(z(interior, '.interior-hud:has(.interior-contents)')).toBeGreaterThan(notice)
  expect(
    z(
      read('./corner-controls.css'),
      '.signpost:has(.journal-toggle[aria-expanded=true], .pocket-toggle[aria-expanded=true])',
    ),
  ).toBeGreaterThan(notice)
})
it('loads the priority contract for every consumer of the shared chrome sheet', () => {
  expect(chrome).toContain("@import './stacking.css'")
  expect(chrome).toMatch(/\.app\s*\{[^}]*isolation:\s*isolate/)
})
