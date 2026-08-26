import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@sj/engine'
import {
  CONSTRUCT_VOCABULARY,
  NARRATOR_TABLES,
  WORLD_TABLES,
  openNarratorDb,
  openNarratorWorld,
  scanPromptForGlassLeak,
} from './glass.js'
import { FIRST_DEFS } from './firsts.js'

it('narrator has no write grant on world tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-glass-'))
  const townPath = join(dir, 'town.db')
  const w = openDb(townPath)
  w.prepare("INSERT INTO events (tick, type, payload) VALUES (0, 'x', '{}')").run()
  w.close()

  const read = openNarratorWorld(townPath) // readonly
  expect(() =>
    read.prepare("INSERT INTO events (tick, type, payload) VALUES (1,'y','{}')").run(),
  ).toThrow(/readonly/)
  expect(() => read.prepare("UPDATE events SET payload = '{}' WHERE seq = 1").run()).toThrow(
    /readonly/,
  )
  expect(() => read.exec('DROP TABLE events')).toThrow(/readonly/)
  expect((read.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(1) // read path works

  const obs = openNarratorDb(join(dir, 'narrator.db')) // narrator's write surface
  const leaked = obs
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${WORLD_TABLES.map(() => '?').join(',')})`,
    )
    .all(...WORLD_TABLES)
  expect(leaked).toEqual([]) // no world table exists in narrator.db
  const owned = obs
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => (r as { name: string }).name)
    .sort()
  const LLM_PLUMBING = ['llm_calls', 'llm_reservations', 'alerts']
  expect(owned.filter((t) => !LLM_PLUMBING.includes(t) && !t.startsWith('sqlite_')).sort()).toEqual(
    [...NARRATOR_TABLES].sort(),
  )

  read.close()
  obs.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('the other face of the glass: what the narrator names never reaches a mind', () => {
  it('catches every milestone kind it can write', () => {
    for (const def of FIRST_DEFS) {
      expect(scanPromptForGlassLeak(`the day of ${def.kind}`), def.kind).toEqual([def.kind])
    }
  })

  it('leaves the human label of a first alone — that is world text, not a label', () => {
    for (const def of FIRST_DEFS) expect(scanPromptForGlassLeak(def.label), def.label).toEqual([])
  })

  it('is the same list the agents side enforces, through one door', () => {
    expect(CONSTRUCT_VOCABULARY).toContain('milestone')
    expect(CONSTRUCT_VOCABULARY).toContain('tier')
  })
})
