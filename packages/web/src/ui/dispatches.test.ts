import { describe, expect, it } from 'vitest'
import {
  EMPTY_DISPATCHES,
  LOUD_HEAT,
  biographyOf,
  dispatchesFrom,
  editions,
  temperOf,
} from './dispatches.js'

const FEED = {
  papers: [
    { day: 0, title: 'They woke', body: 'The first morning.' },
    { day: 6, title: 'The well ran dry', body: 'Nobody drank.' },
  ],
  captions: [{ day: 6, caption: 'Day 6: The well ran dry' }],
  biographies: [
    { subjectId: 'amara', day: 0, title: 'Amara', body: 'A first draft.' },
    { subjectId: 'amara', day: 6, title: 'Amara, who keeps the tally', body: 'She counted.' },
    { subjectId: 'omar', day: 3, title: 'Omar', body: 'He sat with them.' },
  ],
  eras: [{ startDay: 0, endDay: 6, title: 'The First Week', text: 'Seven days.' }],
  institutions: [
    {
      day: 6,
      kind: 'group',
      name: 'the morning watch',
      description: 'They rose together.',
      memberIds: ['amara', 'omar'],
    },
  ],
  heat: [
    { day: 0, total: 1 },
    { day: 6, total: 8 },
  ],
}

describe('dispatchesFrom', () => {
  it('reads a body with tables the narrator has nothing in as empty lists', () => {
    expect(dispatchesFrom({ papers: [{ day: 1, title: 'A', body: 'B' }] })).toEqual({
      ...EMPTY_DISPATCHES,
      papers: [{ day: 1, title: 'A', body: 'B' }],
    })
    expect(dispatchesFrom(null)).toEqual(EMPTY_DISPATCHES)
  })
})

describe('editions', () => {
  it('folds six lists into one edition per day, newest first', () => {
    const out = editions(FEED)
    expect(out.map((e) => e.day)).toEqual([6, 0])
    expect(out[0]).toEqual({
      day: 6,
      title: 'The well ran dry',
      body: 'Nobody drank.',
      caption: 'Day 6: The well ran dry',
      temper: 'a loud day',
      era: { title: 'The First Week', text: 'Seven days.' },
      formed: [{ name: 'the morning watch', description: 'They rose together.' }],
    })
  })

  it('leaves the week banner off every day but the one that closed it', () => {
    expect(editions(FEED)[1]?.era).toBeNull()
  })

  it('says nothing about a day the narrator never scored', () => {
    const out = editions({ ...FEED, heat: [], captions: [] })
    expect(out[0]?.temper).toBeNull()
    expect(out[0]?.caption).toBeNull()
  })
})

describe('temperOf', () => {
  it('reads the narrator’s own marker threshold as the loud line', () => {
    expect(temperOf(LOUD_HEAT)).toBe('a loud day')
    expect(temperOf(LOUD_HEAT - 1)).toBe('a day with something in it')
    expect(temperOf(0)).toBe('a quiet day')
  })
})

describe('biographyOf', () => {
  it('gives the newest life written of a person, and nothing for anybody else', () => {
    expect(biographyOf(FEED, 'amara')).toEqual({
      day: 6,
      title: 'Amara, who keeps the tally',
      body: 'She counted.',
    })
    expect(biographyOf(FEED, 'omar')?.day).toBe(3)
    expect(biographyOf(FEED, 'nobody')).toBeNull()
  })
})

describe('the members of a thing people formed', () => {
  it('reads the array the narrator stores as JSON on the wire', () => {
    const feed = dispatchesFrom({
      institutions: [
        { day: 6, kind: 'group', name: 'the watch', description: '', memberIds: '["amara"]' },
      ],
    })
    expect(feed.institutions[0]!.memberIds).toEqual(['amara'])
  })

  it('takes an array straight, and answers empty for anything else', () => {
    const of = (memberIds: unknown): readonly string[] =>
      dispatchesFrom({
        institutions: [{ day: 0, kind: 'role', name: 'x', description: '', memberIds }],
      }).institutions[0]!.memberIds
    expect(of(['omar'])).toEqual(['omar'])
    expect(of('not json')).toEqual([])
    expect(of(undefined)).toEqual([])
    expect(of([1, 'omar', null])).toEqual(['omar'])
  })
})
