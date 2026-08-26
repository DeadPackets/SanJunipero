import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// SocietyLens mounts a canvas and cannot be imported outside a browser, so — as
// render/worldText.test.ts already does for its label size — the shape is read from source.
const SRC = readFileSync(new URL('./SocietyLens.tsx', import.meta.url), 'utf8')

/** The body of an arrow prop `name={(…) => { … }}`, up to its closing `}}`. */
function propBody(src: string, name: string): string {
  const at = src.indexOf(`${name}={(`)
  expect(at, `no ${name} prop`).toBeGreaterThan(-1)
  const end = src.indexOf('\n        }}', at)
  expect(end, `${name} is not closed at prop indentation`).toBeGreaterThan(at)
  return src.slice(at, end)
}

describe('the bonds graph paints every slab before any name', () => {
  // force-graph runs nodeCanvasObject once per node in array order, so a name drawn there is
  // buried by the next node's opaque slab: five people, two names destroyed.
  it('paints no text in the per-node pass', () => {
    expect(propBody(SRC, 'nodeCanvasObject')).not.toContain('fillText')
  })

  it('paints every name in the post-frame pass, after the last slab is down', () => {
    const post = propBody(SRC, 'onRenderFramePost')
    expect(post).toContain('fillText')
    expect(post, 'the post pass must walk every node, not one').toContain('graphData.nodes')
  })
})

describe('the force layout keeps the positions it computed', () => {
  // A clone carries none of the x/y d3 mutated onto the previous set, so cloning per render
  // restarts the layout on every sim tick.
  it('hands force-graph the memo arrays themselves, uncloned', () => {
    expect(SRC).toContain('graphData={graphData}')
    expect(SRC).toMatch(/const graphData = useMemo\(\(\) => \(\{ nodes: graph\.nodes, links \}\)/)
  })

  it('re-seeds the graph on the bonds beat, never on the world clock', () => {
    const memo =
      /const graph = useMemo\(\s*\(\) => toRelationGraph\(([^)]*)\),\s*\[([^\]]*)\]/.exec(SRC)
    expect(memo, 'no graph memo').not.toBeNull()
    expect(memo![1], 'warmth must read the tick the bonds answer was taken at').toContain(
      'api?.asOfTick ?? 0',
    )
    expect(memo![2], 'the live tick would re-seed the layout every 2.5s').not.toContain('tick')
  })
})
