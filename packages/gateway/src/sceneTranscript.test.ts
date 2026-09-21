import Database from 'better-sqlite3'
import { describe, it, expect } from 'vitest'
import { transcriptAt } from './sceneTranscript.js'

describe('public scene transcript', () => {
  it('catches up twelve rapid turns without future lines, private asides or duplicate speech', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE events(seq INTEGER PRIMARY KEY, tick INTEGER, type TEXT, payload TEXT)')
    const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
    for (let i = 1; i <= 12; i++) {
      const line = { id: 'scene', agentId: 'amara', text: `Line ${i}`, aside: 'private' }
      insert.run(i * 2, i + 1, 'scene_line', JSON.stringify(line))
      insert.run(i * 2 + 1, i + 1, 'agent_spoke', JSON.stringify(line))
    }
    expect(transcriptAt(db, 'scene', 7).lines).toHaveLength(6)
    expect(transcriptAt(db, 'scene', 11).lines).toHaveLength(10)
    const result = transcriptAt(db, 'scene', 13)
    expect(result.lines.map((l) => l.seq)).toEqual(
      Array.from({ length: 12 }, (_, i) => (i + 1) * 2),
    )
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result.catchup).toBe(true)
    db.close()
  })

  it('returns the last hundred public lines and discloses truncation for a closed scene', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE events(seq INTEGER PRIMARY KEY, tick INTEGER, type TEXT, payload TEXT)')
    const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
    for (let i = 1; i <= 105; i++)
      insert.run(i, i, 'scene_line', JSON.stringify({ id: 'scene', agentId: 'a', text: `${i}` }))
    insert.run(106, 106, 'scene_closed', JSON.stringify({ id: 'scene' }))
    const result = transcriptAt(db, 'scene', 110)
    expect(result.lines).toHaveLength(100)
    expect(result.lines[0]?.seq).toBe(6)
    expect(result.truncated).toBe(true)
    db.close()
  })
})
