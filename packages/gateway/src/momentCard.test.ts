import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, type Moment } from '@sj/shared'
import { cardDateline, momentAt, platePaint, renderMomentCard, titleLines } from './momentCard.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

const m = (over: Partial<Moment> = {}): Moment => ({
  id: 1,
  day: 2,
  startTick: 2 * MINUTES_PER_DAY + 13 * 60 + 20, // day 2, 13:20
  endTick: 2 * MINUTES_PER_DAY + 14 * 60,
  title: 'the well',
  cast: ['a1', 'a2'],
  location: 'the plaza',
  kind: 'council',
  stakes: 6,
  summary: 'They agreed to dig.',
  ...over,
})

const NAMES: Record<string, string> = { a1: 'Rahel', a2: 'Tomas', a3: 'Omar', a4: 'Nadia' }
const names = (id: string): string => NAMES[id] ?? id

// ★ `momentThumb.ts` claimed a real thumbnail of a moment would need a second headless renderer.
// It does not: `sharp` is already in the gateway and `agentCard.ts` already crops busts out of
// the atlas, so a postcard is a tinted plate, the faces, the place and the title.
describe('★ a moment has a real picture, and it costs no second renderer', () => {
  it('★ needs nothing the gateway did not already have', () => {
    expect(src('./agentCard.ts')).toContain('sharp(sheet.png)')
    expect(src('./momentCard.ts')).not.toContain('puppeteer')
    expect(src('./momentCard.ts')).not.toContain('canvas')
  })

  it('★ tints the plate by the HOUR, off the town’s own phase boundary', () => {
    const at = (h: number): string => platePaint(h * 60).ground
    expect(at(13)).not.toBe(at(23)) // noon is not midnight
    expect(at(5)).not.toBe(at(13)) // dawn is not day
    expect(at(19)).not.toBe(at(23)) // dusk is not night
    // and the night plate carries LIGHT ink, or the title is invisible on it
    expect(platePaint(23 * 60).ink).toBe('#FFF6E9')
    expect(platePaint(13 * 60).ink).toBe('#43394A')
  })

  it('★ draws the busts, the title and the dateline, and nothing that is a number', () => {
    const svg = renderMomentCard(m(), ['data:image/png;base64,AA', null], names)
    expect(svg).toContain('the well')
    expect(svg).toContain('Day 2 · 13:20 · the plaza · Rahel, Tomas')
    expect(svg).toContain('image-rendering="pixelated"')
    expect(svg.match(/<image /g)).toHaveLength(1) // the null bust draws nothing at all
    expect(svg).not.toMatch(/stakes|tier|score/i)
  })

  it('names at most three faces and says how many more, never a coordinate', () => {
    expect(cardDateline(m({ cast: ['a1', 'a2', 'a3', 'a4'] }), names)).toContain(
      'Rahel, Tomas, Omar +1',
    )
    expect(cardDateline(m({ location: null, cast: [] }), names)).toBe('Day 2 · 13:20')
  })

  it('escapes a title the town wrote, so no scene can break the card', () => {
    const svg = renderMomentCard(m({ title: 'the <well> & the "road"' }), [], names)
    expect(svg).toContain('&lt;well&gt;')
    expect(svg).not.toContain('<well>')
  })

  it('wraps a long title to two lines and cuts the rest rather than running off the plate', () => {
    expect(titleLines('the well')).toEqual(['the well'])
    const long = titleLines(
      'whether the storehouse should be opened before the winter has properly set in at all',
    )
    expect(long).toHaveLength(2)
    for (const line of long) expect(line.length).toBeLessThanOrEqual(30)
  })
})

describe('the card a shared minute opens with is the room that was in it', () => {
  const day2 = m({ id: 1 })
  const later = m({
    id: 2,
    startTick: 2 * MINUTES_PER_DAY + 20 * 60,
    endTick: 2 * MINUTES_PER_DAY + 20 * 60 + 30,
  })

  it('takes the scene running at that minute', () => {
    expect(momentAt([day2, later], day2.startTick + 5, 2)?.id).toBe(1)
    expect(momentAt([day2, later], later.startTick, 2)?.id).toBe(2)
  })

  it('falls back to the day’s own lead where the link points between rooms', () => {
    // the list arrives already sorted, so the first row of a day IS its lead
    expect(momentAt([day2, later], 2 * MINUTES_PER_DAY + 60, 2)?.id).toBe(1)
  })

  it('answers null for a day the town held no scene in, and the day card takes over', () => {
    expect(momentAt([day2], 9 * MINUTES_PER_DAY, 9)).toBeNull()
    expect(src('./shareCard.ts')).toContain('if (scene === null)')
    expect(src('./shareCard.ts')).toContain('renderShareCard({')
  })
})
