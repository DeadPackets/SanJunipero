import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { MOMENT_MAX, makeMomentsReader } from './moments.js'
import type { WorldMirror } from './worldMirror.js'

const worldWith = (scenes: number): Database.Database => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE events (seq INTEGER PRIMARY KEY, tick INTEGER, type TEXT, payload TEXT)')
  const ins = db.prepare('INSERT INTO events (seq, tick, type, payload) VALUES (?, ?, ?, ?)')
  for (let i = 0; i < scenes; i++) {
    const id = `sc_${i}`
    ins.run(2 * i + 1, 10 * i, 'scene_opened', JSON.stringify({ id, kind: 'talk', stakes: i }))
    ins.run(2 * i + 2, 10 * i + 5, 'scene_closed', JSON.stringify({ id, summary: '' }))
  }
  return db
}

/** Counts what the reader asks the log for: the whole point of the memo and the bound. */
const counted = (db: Database.Database): { db: Database.Database; rows: () => number } => {
  let rows = 0
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'prepare') return Reflect.get(target, prop, receiver) as unknown
      return (sql: string) => {
        const stmt = target.prepare(sql)
        return new Proxy(stmt, {
          get(s, p, r) {
            if (p !== 'all') return Reflect.get(s, p, r) as unknown
            return (...args: unknown[]) => {
              const out = s.all(...args)
              rows += out.length
              return out
            }
          },
        })
      }
    },
  })
  return { db: proxy, rows: () => rows }
}

const mirrorAt = (seq: () => number): WorldMirror =>
  ({ seq, state: () => ({ structures: {} }) }) as unknown as WorldMirror

describe('the moments reader', () => {
  it('★ reads the log once per world generation, however many cards ask', () => {
    const { db, rows } = counted(worldWith(3))
    let seq = 10
    const moments = makeMomentsReader({ db, mirror: mirrorAt(() => seq), narratorDb: null })
    expect(moments()).toHaveLength(3)
    const after = rows()
    for (let i = 0; i < 20; i++) moments()
    expect(rows(), 'twenty more asks in one generation cost nothing').toBe(after)
    seq = 11
    moments()
    expect(rows()).toBeGreaterThan(after)
  })

  it('★ reads the newest scenes only, not the whole life of the town', () => {
    const { db, rows } = counted(worldWith(MOMENT_MAX * 3))
    const moments = makeMomentsReader({ db, mirror: mirrorAt(() => 1), narratorDb: null })
    expect(moments()).toHaveLength(MOMENT_MAX)
    expect(rows()).toBeLessThanOrEqual(MOMENT_MAX * 2)
  })
})
