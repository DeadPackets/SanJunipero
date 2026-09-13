import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { whyOf, type StakeScore } from '@sj/shared'
import { createWorldStore } from '../state/worldStore.js'
import { boardRows } from '../ui/threadModel.js'
import {
  BOARD_ROOM,
  ShotBoard,
  ShotBoardBody,
  boardCards,
  boardKey,
  holderKey,
  sharePercent,
  splitWhy,
} from './ShotBoard.js'

const row = (over: Partial<StakeScore> = {}): StakeScore => ({
  sceneId: 'sc_1',
  agentIds: ['nadia', 'yusuf'],
  score: 20,
  why: 'Nadia & Yusuf: falling out',
  ...over,
})

const cards = (rows: readonly StakeScore[], cut: StakeScore | null, room = BOARD_ROOM) =>
  boardCards(boardRows(rows), cut, room)

const rankOf = (list: readonly { key: string; rank: number }[], key: string): number =>
  list.find((c) => c.key === key)?.rank ?? -1

describe('the reason a row carries, split from the names it starts with', () => {
  it('splits on the colon `whyOf` joins with', () => {
    expect(splitWhy(whyOf('Nadia & Yusuf', ['quarrel']))).toEqual({
      who: 'Nadia & Yusuf',
      reason: 'falling out',
    })
  })

  it('keeps two reasons together, because the second colon is not a join', () => {
    expect(splitWhy('Nadia & Yusuf: falling out, a slight').reason).toBe('falling out, a slight')
  })

  it('reads a row with no terms as names alone, and gives it no reason', () => {
    expect(splitWhy(whyOf('Nadia', []))).toEqual({ who: 'Nadia', reason: null })
  })
})

describe('which row the camera is holding', () => {
  it('is the gateway’s own identity for a candidate, scene and cast', () => {
    expect(boardKey('sc_1', ['nadia', 'yusuf'])).toBe(boardKey('sc_1', ['nadia', 'yusuf']))
    expect(boardKey(null, ['nadia'])).not.toBe(boardKey('sc_1', ['nadia']))
  })

  it('★ finds the holder with no beatId anywhere: the gateway puts one on the cut alone', () => {
    const cut = row({ sceneId: 'sc_2', agentIds: ['maret'], why: 'Maret: a slight' })
    const list = cards([row(), cut], cut)
    expect(cut.beatId).toBeUndefined()
    expect(list.filter((c) => c.lit).map((c) => c.who)).toEqual(['Maret'])
  })

  it('lights nothing when the shot has decayed off the survey the board came in', () => {
    const gone = row({ sceneId: 'sc_9', agentIds: ['omar'], why: 'Omar: a death' })
    expect(cards([row()], gone).some((c) => c.lit)).toBe(false)
  })

  it('lights nothing at all in a quiet minute, and never throws doing it', () => {
    expect(cards([], null)).toEqual([])
    expect(holderKey(null)).toBeNull()
    expect(holderKey(undefined)).toBeNull()
  })
})

describe('★ the pre-roll: a candidate rises before the cut lands', () => {
  const held = row({ sceneId: 'sc_1', agentIds: ['nadia', 'yusuf'], score: 20 })
  const rival = row({
    sceneId: 'sc_2',
    agentIds: ['maret', 'omar'],
    score: 23,
    why: 'Maret: a slight',
  })

  it('puts the overtaking row at rank 0 while the cut is still the row below it', () => {
    // The gateway's survey is score-ordered but the shot is sticky by a quarter, so a 23 over a
    // 20 tops the board and does not yet take the camera.
    const list = cards([rival, held], held)
    expect(rankOf(list, boardKey('sc_2', ['maret', 'omar']))).toBe(0)
    expect(rankOf(list, boardKey('sc_1', ['nadia', 'yusuf']))).toBe(1)
    expect(list.find((c) => c.lit)?.key).toBe(boardKey('sc_1', ['nadia', 'yusuf']))
  })

  it('★ keeps the DOM order fixed across that swap, so the rise is a transform and not a reflow', () => {
    const before = cards([held, rival], held).map((c) => c.key)
    const after = cards([rival, held], rival).map((c) => c.key)
    expect(after).toEqual(before)
  })

  it('hands the light over on the next frame, with the ranks unchanged', () => {
    const list = cards([rival, held], rival)
    expect(rankOf(list, boardKey('sc_2', ['maret', 'omar']))).toBe(0)
    expect(list.find((c) => c.lit)?.key).toBe(boardKey('sc_2', ['maret', 'omar']))
  })
})

describe('the three the board has room for', () => {
  const five = [1, 2, 3, 4, 5].map((n) =>
    row({
      sceneId: `sc_${String(n)}`,
      agentIds: [`a${String(n)}`],
      score: 30 - n,
      why: `A${String(n)}: a slight`,
    }),
  )

  it('takes the top three and ranks them by share', () => {
    const list = cards(five, null)
    expect(list).toHaveLength(3)
    expect(list.map((c) => c.rank).sort()).toEqual([0, 1, 2])
    expect(rankOf(list, boardKey('sc_1', ['a1']))).toBe(0)
  })

  it('★ keeps the shot the picture is standing under, even when it has fallen past the third', () => {
    const list = cards(five, five[4]!)
    expect(list).toHaveLength(3)
    expect(list.find((c) => c.lit)?.who).toBe('A5')
    expect(rankOf(list, boardKey('sc_3', ['a3']))).toBe(-1)
  })

  it('normalises every bar against the leader of the same frame', () => {
    const list = cards(five, null)
    expect(list.map((c) => c.share).every((s) => s > 0 && s <= 1)).toBe(true)
    expect(Math.max(...list.map((c) => c.share))).toBe(1)
  })

  it('asks for no rows and gets none', () => {
    expect(cards(five, null, 0)).toEqual([])
  })
})

describe('the width a share is drawn at', () => {
  it('is a percent, clamped at both ends', () => {
    expect(sharePercent(0.5)).toBe('50.0%')
    expect(sharePercent(4)).toBe('100.0%')
    expect(sharePercent(-1)).toBe('0.0%')
  })
})

describe('what the board actually renders', () => {
  it('★ prints no raw score, whatever the survey is carrying', () => {
    const html = renderToStaticMarkup(
      createElement(ShotBoardBody, {
        cards: cards(
          [
            row({ score: 2915 }),
            row({ sceneId: 'sc_2', agentIds: ['maret'], score: 1740, why: 'Maret: a death' }),
          ],
          null,
        ),
      }),
    )
    const words = html.replace(/<[^>]*>/g, ' ')
    expect(words).not.toMatch(/\b\d{4,}\b/)
    expect(words).not.toMatch(/_/)
  })

  it('names the cast and the reason of every row it draws', () => {
    const html = renderToStaticMarkup(
      createElement(ShotBoardBody, { cards: cards([row()], row()) }),
    )
    expect(html).toContain('Nadia &amp; Yusuf')
    expect(html).toContain('falling out')
    expect(html).toContain('shot-row lit')
  })

  it('draws nothing at all before the store has a board, and never throws doing it', () => {
    expect(renderToStaticMarkup(createElement(ShotBoard, { store: createWorldStore() }))).toBe('')
  })
})
