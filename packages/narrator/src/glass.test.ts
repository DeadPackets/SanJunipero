import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@sj/engine'
import { NARRATOR_TABLES, WORLD_TABLES, openNarratorDb, openNarratorWorld } from './glass.js'

it('narrator has no write grant on world tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-glass-'))
  const townPath = join(dir, 'town.db')
  const w = openDb(townPath)
  w.prepare("INSERT INTO events (tick, type, payload) VALUES (0, 'x', '{}')").run()
  w.close()

  const read = openNarratorWorld(townPath) // readonly
  expect(() => read.prepare("INSERT INTO events (tick, type, payload) VALUES (1,'y','{}')").run())
    .toThrow(/readonly/)
  expect(() => read.prepare("UPDATE events SET payload = '{}' WHERE seq = 1").run())
    .toThrow(/readonly/)
  expect(() => read.exec('DROP TABLE events')).toThrow(/readonly/)
  expect((read.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(1) // read path works

  const obs = openNarratorDb(join(dir, 'narrator.db')) // narrator's write surface
  const leaked = obs
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${WORLD_TABLES.map(() => '?').join(',')})`)
    .all(...WORLD_TABLES)
  expect(leaked).toEqual([]) // no world table exists in narrator.db
  const owned = obs
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => (r as { name: string }).name)
    .sort()
  const LLM_PLUMBING = ['llm_calls', 'llm_reservations', 'alerts']
  expect(owned.filter((t) => !LLM_PLUMBING.includes(t) && !t.startsWith('sqlite_')).sort())
    .toEqual([...NARRATOR_TABLES].sort())

  read.close()
  obs.close()
  rmSync(dir, { recursive: true, force: true })
})
