import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, MINUTES_PER_DAY } from '@sj/shared'
import { NARRATOR_DDL } from '@sj/shared/narratorSchema'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { TOWN_NAME, shareRouteDay } from './shareCard.js'
import { withShareTags } from './staticSite.js'
import { createGateway, type Gateway } from './server.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${TOWN_NAME} — a small town, watched kindly</title>
  </head>
  <body><div id="root"></div></body>
</html>
`

function scriptedWorld(dbPath: string): Database.Database {
  const db = openDb(dbPath)
  const loop = new TickLoop({
    store: new EventStore(db),
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('share-card-test'),
    snapshotEveryTicks: 25,
    onTick: ({ tick, emit }) => {
      if (tick === 1) emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: 7300 })
    },
  })
  for (let i = 0; i < 40; i++) loop.step()
  return db
}

describe('shareRouteDay — which pages a link is ever pasted from', () => {
  it('names the live day for the root, and the linked day for a minute', () => {
    expect(shareRouteDay('/', 3 * MINUTES_PER_DAY + 30)).toBe(3)
    expect(shareRouteDay('/moment/4/19:31', 0)).toBe(4)
    expect(shareRouteDay('/moment/day4/19:31', 0)).toBe(4)
  })

  it('answers for nothing else — a scene id names its own day, and a page is not a link', () => {
    expect(shareRouteDay('/moment/7', 0)).toBeNull()
    expect(shareRouteDay('/moment/4/99:99', 0)).toBeNull()
    expect(shareRouteDay('/moment/4/19:31/extra', 0)).toBeNull()
    expect(shareRouteDay('/api/chronicle', 0)).toBeNull()
  })
})

describe('withShareTags', () => {
  const html = withShareTags(INDEX_HTML, {
    title: 'What the Fire Took — San Junipero',
    description: 'Day 1 in San Junipero. "quotes" & <angles>',
    image: '/card/moment/1/00:00.svg',
  })

  it('puts the four tags a paste needs inside the head', () => {
    expect(html.indexOf('og:title')).toBeGreaterThan(html.indexOf('<head>'))
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('</head>'))
    expect(html).toContain('<meta property="og:description"')
    expect(html).toContain('<meta property="og:image" content="/card/moment/1/00:00.svg" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
  })

  it('escapes the attribute, so a chapter title cannot close it', () => {
    expect(html).toContain('&quot;quotes&quot; &amp; &lt;angles&gt;')
    expect(html).not.toContain('<angles>')
  })
})

describe('the card route and the tags the app is served with', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-card-'))
  const site = join(dir, 'site')
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    mkdirSync(site)
    writeFileSync(join(site, 'index.html'), INDEX_HTML)
    const dbPath = join(dir, 'world.db')
    const world = scriptedWorld(dbPath)

    const narratorPath = join(dir, 'narrator.db')
    const ndb = new Database(narratorPath)
    ndb.exec(NARRATOR_DDL)
    ndb
      .prepare('INSERT INTO chapters (day, title, text, citations, scene_ids) VALUES (?,?,?,?,?)')
      .run(1, 'What the Fire Took', 'It burned.', '[]', '[]')
    ndb
      .prepare(
        'INSERT INTO scenes (day, start_tick, end_tick, event_ids, "cast", location) VALUES (?,?,?,?,?,?)',
      )
      .run(1, 1440, 1500, '[]', '["alice"]', 'the plaza')
    ndb
      .prepare(
        `INSERT INTO heat_scores (scene_id, conflict, novelty, firsts, stakes, dramatic_irony, total)
         VALUES (1, 0, 0, 0, 0, 0, 7)`,
      )
      .run()
    ndb
      .prepare(
        'INSERT INTO publications (day, kind, title, body, citations, subject_id) VALUES (?,?,?,?,?,?)',
      )
      .run(1, 'timelapse_caption', 'Day 1', 'the night the roof went', null, null)
    ndb.close()

    gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db: world,
      narratorDbPath: narratorPath,
      staticDir: site,
    })
    base = `http://127.0.0.1:${gw.port}`
  })

  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('draws the day the link names, in the narrator’s own card', async () => {
    const res = await fetch(`${base}/card/moment/1/19:31.svg`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/svg+xml')
    const svg = await res.text()
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('What the Fire Took')
    expect(svg).toContain('19:31 · the night the roof went')
    expect(svg).toContain('Day 1')
  })

  it('names a day the narrator has not written by its number, rather than failing', async () => {
    const svg = await (await fetch(`${base}/card/moment/9/06:00.svg`)).text()
    expect(svg).toContain('Day 9')
    expect(svg).toContain(TOWN_NAME)
  })

  it('refuses a card for a minute that is not one', async () => {
    expect((await fetch(`${base}/card/moment/1/99:99.svg`)).status).toBe(404)
    expect((await fetch(`${base}/card/moment/1/19:31.png`)).status).toBe(404)
  })

  it('serves the deep link’s own tags, pointing at that day’s card', async () => {
    const html = await (await fetch(`${base}/moment/1/19:31`)).text()
    expect(html).toContain('<meta property="og:title" content="What the Fire Took — San Junipero"')
    expect(html).toContain('content="/card/moment/1/00:00.svg"')
    expect(html).toContain('the night the roof went')
  })

  it('serves the root the day the town is living', async () => {
    const html = await (await fetch(`${base}/`)).text()
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html).toContain('og:title')
  })
})
