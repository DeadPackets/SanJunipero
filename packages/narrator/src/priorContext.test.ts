import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { priorContext } from './priorContext.js'

it('carries dated relevant public speech, never private, future or unrelated evidence', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE events (seq INTEGER, tick INTEGER, type TEXT, payload TEXT)')
  const put = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
  const line = 'I will bring you a chair tomorrow, if I can finish it.'
  for (const [seq, tick, type, agentId, text] of [
    [1, 100, 'agent_spoke', 'amara', line],
    [2, 101, 'agent_thought', 'amara', 'A secret which never left my mind.'],
    [3, 102, 'agent_spoke', 'yusuf', 'My unrelated work must not become her promise.'],
    [4, 2881, 'agent_spoke', 'amara', 'This future promise is not known yet.'],
  ] as const)
    put.run(seq, tick, type, JSON.stringify({ agentId, text }))
  const rows = priorContext(
    db,
    [
      {
        seq: 5,
        tick: 1441,
        type: 'agent_spoke',
        payload: { agentId: 'amara', text: 'The chair is ready.' },
      },
    ],
    () => 'Amara',
  )
  expect(rows).toEqual([{ eventSeq: 1, day: 0, text: `Amara said: "${line}"` }])
  db.close()
})

describe('bounded context', () => {
  it('handles an empty day without querying history', () => {
    const db = new Database(':memory:')
    expect(priorContext(db, [], String)).toEqual([])
    db.close()
  })
})

it('keeps two public promises to the same person as separate dated sources', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE events (seq INTEGER, tick INTEGER, type TEXT, payload TEXT)')
  const put = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
  for (const [seq, summary] of [
    [1, 'Amara promised Yusuf a chair.'],
    [2, 'Amara promised Yusuf help at harvest.'],
  ] as const)
    put.run(
      seq,
      seq,
      'scene_closed',
      JSON.stringify({ id: `s${seq}`, participants: ['amara', 'yusuf'], summary }),
    )
  const rows = priorContext(
    db,
    [{ seq: 3, tick: 1441, type: 'scene_opened', payload: { participants: ['amara', 'yusuf'] } }],
    String,
  )
  expect(rows.map((r) => r.eventSeq)).toEqual([1, 2])
  expect(rows.map((r) => r.text)).toEqual([
    'Amara promised Yusuf a chair.',
    'Amara promised Yusuf help at harvest.',
  ])
  db.close()
})

it('reserves two public town outcomes within the cap without inventing an actor', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE events (seq INTEGER, tick INTEGER, type TEXT, payload TEXT)')
  const put = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
  put.run(1, 10, 'structure_completed', JSON.stringify({ id: 'house' }))
  put.run(2, 11, 'crop_harvested', JSON.stringify({ cropId: 'wheat' }))
  for (let seq = 3; seq <= 18; seq++)
    put.run(
      seq,
      seq + 10,
      'agent_spoke',
      JSON.stringify({
        agentId: 'amara',
        text: `I am carrying wood back from the river, journey ${seq}.`,
      }),
    )
  const rows = priorContext(
    db,
    [
      {
        seq: 19,
        tick: 1441,
        type: 'agent_spoke',
        payload: { agentId: 'amara', text: 'What happened yesterday?' },
      },
    ],
    () => 'Amara',
  )
  expect(rows).toHaveLength(12)
  expect(rows.slice(0, 2)).toEqual([
    { eventSeq: 1, day: 0, text: 'A building was finished.' },
    { eventSeq: 2, day: 0, text: 'A crop was brought in.' },
  ])
  expect(rows.slice(2).every((row) => row.text.startsWith('Amara said:'))).toBe(true)
  expect(rows.map((row) => row.eventSeq)).toEqual([1, 2, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  db.close()
})

it('can carry a town outcome when today also has no named actor', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE events (seq INTEGER, tick INTEGER, type TEXT, payload TEXT)')
  db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(
    1,
    10,
    'crop_harvested',
    JSON.stringify({ cropId: 'wheat' }),
  )
  expect(
    priorContext(
      db,
      [{ seq: 2, tick: 1441, type: 'structure_completed', payload: { id: 'house' } }],
      String,
    ),
  ).toEqual([{ eventSeq: 1, day: 0, text: 'A crop was brought in.' }])
  db.close()
})

it('does not carry a seeded roof into a later day as a town achievement', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE events (seq INTEGER, tick INTEGER, type TEXT, payload TEXT)')
  const put = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
  put.run(1, 10, 'structure_completed', JSON.stringify({ id: 'seeded', seeded: true }))
  put.run(2, 20, 'structure_completed', JSON.stringify({ id: 'built' }))
  expect(
    priorContext(
      db,
      [{ seq: 3, tick: 1441, type: 'crop_harvested', payload: { cropId: 'wheat' } }],
      String,
    ),
  ).toEqual([{ eventSeq: 2, day: 0, text: 'A building was finished.' }])
  db.close()
})
