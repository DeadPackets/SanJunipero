import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OutOfReach } from './OutOfReach.js'
import { EMPTY_COPY, GAMIFICATION_BAN, OUT_OF_REACH } from './townStats.js'

const html = renderToStaticMarkup(createElement(OutOfReach, { onRetry: () => {} }))

describe('what a page shows when the wire drops, not when the town is quiet', () => {
  it('★ says the record was not read — never that the town has nothing', () => {
    expect(html).toContain(OUT_OF_REACH.says)
    for (const copy of Object.values(EMPTY_COPY)) expect(html).not.toContain(copy)
  })

  it('★ offers the way back, as a control of this world', () => {
    expect(html).toContain(OUT_OF_REACH.again)
    expect(html).toContain('<button type="button" class="feed-tab"')
  })

  it('keeps the town’s own language', () => {
    for (const line of Object.values(OUT_OF_REACH)) expect(line).not.toMatch(GAMIFICATION_BAN)
    expect(OUT_OF_REACH.says).not.toMatch(/error|failed|retry|500|offline/i)
  })
})
