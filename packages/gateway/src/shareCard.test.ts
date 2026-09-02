import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, MINUTES_PER_DAY } from '@sj/shared'
import { AssetCodex, decodePng, encodePng, openForgeDb, type RawImage } from '@sj/forge'
import { NARRATOR_DDL } from '@sj/shared/narratorSchema'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { CARD_HEIGHT, CARD_WIDTH } from './agentCard.js'
import {
  TOWN_NAME,
  TOWN_STRAPLINE,
  shareRouteAgent,
  shareRouteDay,
  shareRouteScene,
  type ShareMeta,
} from './shareCard.js'
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
      if (tick === 1)
        emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
    },
  })
  // Into day 2: a card is refused for a day the town has not lived, so the fixture must live
  // past every day its links name.
  for (let i = 0; i < 2 * MINUTES_PER_DAY + 40; i++) loop.step()
  return db
}

describe('shareRouteDay — which pages a link is ever pasted from', () => {
  it('names the live day for the root, and the linked day for a minute', () => {
    expect(shareRouteDay('/', 3 * MINUTES_PER_DAY + 30)).toBe(3)
    expect(shareRouteDay('/moment/4/19:31', 9 * MINUTES_PER_DAY)).toBe(4)
    expect(shareRouteDay('/moment/day4/19:31', 9 * MINUTES_PER_DAY)).toBe(4)
    expect(shareRouteDay('/moment/4/19:31', 0), 'a day the town has not lived').toBeNull()
  })

  it('names the person a `/agent/:id` link is pasted from, and nobody else', () => {
    expect(shareRouteAgent('/agent/alice')).toBe('alice')
    expect(shareRouteAgent('/agent/alice/journal')).toBeNull()
    expect(shareRouteAgent('/moment/4/19:31')).toBeNull()
  })

  it('answers for nothing else — a scene id names its own day, and a page is not a link', () => {
    expect(shareRouteDay('/moment/7', 0)).toBeNull()
    expect(shareRouteDay('/moment/4/99:99', 0)).toBeNull()
    expect(shareRouteDay('/moment/4/19:31/extra', 0)).toBeNull()
    expect(shareRouteDay('/api/chronicle', 0)).toBeNull()
  })

  it('★ reads the scene a `/moment/:id` link names — the day itself answers for it', () => {
    expect(shareRouteScene('/moment/7')).toBe(7)
    expect(shareRouteScene('/moment/0')).toBeNull()
    expect(shareRouteScene('/moment/day7')).toBeNull()
    expect(shareRouteScene('/moment/4/19:31')).toBeNull()
    expect(shareRouteScene('/agent/alice')).toBeNull()
  })

  it('★ has a line of its own to fall back on, so no unfurl says the town twice', () => {
    expect(TOWN_STRAPLINE).not.toContain(TOWN_NAME)
  })
})

describe('withShareTags', () => {
  const META: ShareMeta = {
    title: 'What the Fire Took — San Junipero',
    description: 'Day 1 in San Junipero. "quotes" & <angles>',
    image: '/card/moment/1/00:00.png',
    imageAlt: 'What the Fire Took — day 1 of San Junipero',
    type: 'article',
    canonical: '/moment/1/00:00',
  }
  const html = withShareTags(INDEX_HTML, META, 'https://town.example')

  it('puts the tags a paste needs inside the head, sized so no client has to guess', () => {
    expect(html.indexOf('og:title')).toBeGreaterThan(html.indexOf('<head>'))
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('</head>'))
    expect(html).toContain('<meta property="og:description"')
    expect(html).toContain(`<meta property="og:image:width" content="${CARD_WIDTH}" />`)
    expect(html).toContain(`<meta property="og:image:height" content="${CARD_HEIGHT}" />`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
  })

  it('★ rewrites the title, so a tab and a search result are not all one page', () => {
    expect(html).toContain('<title>What the Fire Took — San Junipero</title>')
    expect(html).not.toContain('a small town, watched kindly</title>')
  })

  it('★ writes a description Google reads — `og:description` is not one', () => {
    expect(html).toContain('<meta name="description" content="Day 1 in San Junipero.')
  })

  it('★ makes the card absolute and names the ONE address of the page', () => {
    expect(html).toContain(
      '<meta property="og:image" content="https://town.example/card/moment/1/00:00.png" />',
    )
    expect(html).toContain('<link rel="canonical" href="https://town.example/moment/1/00:00" />')
    expect(html).toContain('<meta property="og:url" content="https://town.example/moment/1/00:00"')
    expect(html).toContain('<meta property="og:type" content="article" />')
    expect(html).toContain('<meta property="og:site_name" content="San Junipero" />')
    expect(html).toContain('<meta property="og:locale" content="en_US" />')
    expect(html).toContain('<meta property="og:image:alt"')
    expect(html).toContain('<meta name="twitter:image:alt"')
  })

  it('★ carries structured data a crawler can read without running the app', () => {
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? ''
    const graph = JSON.parse(ld.replace(/\\u003c/g, '<')) as Record<string, unknown>
    expect(graph['@type']).toBe('Article')
    expect(graph.headline).toBe(META.title)
    expect(graph.url).toBe('https://town.example/moment/1/00:00')
  })

  it('escapes the attribute, so a chapter title cannot close it', () => {
    expect(html).toContain('&quot;quotes&quot; &amp; &lt;angles&gt;')
    expect(html).not.toContain('<angles>')
    expect(html).not.toContain('</angles>')
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
    expect(svg).toContain('the night the roof went')
    expect(svg).toContain('Day 1')
  })

  it('names a day the narrator has not written by its number, rather than failing', async () => {
    const svg = await (await fetch(`${base}/card/moment/2/06:00.svg`)).text()
    expect(svg).toContain('Day 2')
    expect(svg).toContain(TOWN_NAME)
  })

  it('refuses a card for a minute that is not one, and a format it does not draw', async () => {
    expect((await fetch(`${base}/card/moment/1/99:99.svg`)).status).toBe(404)
    expect((await fetch(`${base}/card/moment/1/99:99.png`)).status).toBe(404)
    expect((await fetch(`${base}/card/moment/1/19:31.gif`)).status).toBe(404)
  })

  /** Every (day, minute) pair used to be its own SVG and its own 43 ms sharp job, over a day
   *  with no ceiling — unbounded CPU from a stranger with a URL. */
  it('★ draws only days the town has lived, and one card for all 1440 minutes of one', async () => {
    expect((await fetch(`${base}/card/moment/9/06:00.png`)).status).toBe(404)
    expect((await fetch(`${base}/card/moment/999999/06:00.svg`)).status).toBe(404)
    const noon = await (await fetch(`${base}/card/moment/1/12:00.svg`)).text()
    const night = await (await fetch(`${base}/card/moment/1/23:59.svg`)).text()
    expect(noon).toBe(night)
  })

  // Twitter, Slack, Discord, Facebook, LinkedIn and iMessage all refuse an SVG for `og:image`.
  it('rasterizes the same card, so a pasted link unfurls with a picture', async () => {
    const res = await fetch(`${base}/card/moment/1/19:31.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const bytes = Buffer.from(await res.arrayBuffer())
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const img = await decodePng(bytes)
    expect([img.width, img.height]).toEqual([CARD_WIDTH, CARD_HEIGHT])
  })

  it('serves the deep link’s own tags, pointing at that day’s card', async () => {
    const html = await (await fetch(`${base}/moment/1/19:31`)).text()
    expect(html).toContain('<meta property="og:title" content="What the Fire Took — San Junipero"')
    expect(html).toContain(`content="${base}/card/moment/1/00:00.png"`)
    expect(html).toContain('the night the roof went')
  })

  it('serves the root the day the town is living', async () => {
    const html = await (await fetch(`${base}/`)).text()
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html).toContain('og:title')
    expect(html).toContain('<meta property="og:type" content="website" />')
  })

  it('★ unfurls `/moment/:id` — a recorded day is the most shareable thing the town has', async () => {
    const res = await fetch(`${base}/moment/1`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<meta property="og:title" content="What the Fire Took — San Junipero"')
    expect(html).toContain('<meta property="og:type" content="article" />')
    expect(html).toContain('/moment/1"')
  })

  it('★ names one address for a whole day, so every scrubbed minute is not its own page', async () => {
    const html = await (await fetch(`${base}/moment/1/19:31`)).text()
    expect(html).toContain('rel="canonical"')
    expect(html).toContain('/moment/1/00:00" />')
    expect(html).not.toContain('/moment/1/19:31" />')
  })

  it('★ never says the town’s name twice in one sentence', async () => {
    const html = await (await fetch(`${base}/moment/2/06:00`)).text()
    expect(html).not.toContain('Day 2 in San Junipero. San Junipero')
    expect(html).toContain('Day 2 in San Junipero. A town of minds')
  })

  it('★ 404s a path that is not a page, rather than indexing every typo as the town', async () => {
    for (const path of ['/nonsense', '/moment/1/19:31/extra', '/moment/404']) {
      const res = await fetch(`${base}${path}`)
      expect(res.status, path).toBe(404)
      expect(await res.text()).toContain('<div id="root">') // the app still answers for itself
    }
  })

  it('★ tells a crawler where it may walk, and hands it every page', async () => {
    const robots = await (await fetch(`${base}/robots.txt`)).text()
    expect(robots).toContain('Disallow: /api/')
    expect(robots).toContain('Disallow: /admin/')
    expect(robots).toContain(`Sitemap: ${base}/sitemap.xml`)

    const res = await fetch(`${base}/sitemap.xml`)
    expect(res.headers.get('content-type')).toContain('application/xml')
    const xml = await res.text()
    expect(xml).toContain(`<loc>${base}/</loc>`)
    expect(xml).toContain(`<loc>${base}/agent/alice</loc>`)
    expect(xml).toContain(`<loc>${base}/moment/1/00:00</loc>`)
  })

  it('keeps the living day’s card on a short lease — it is rewritten as the day is lived', async () => {
    const live = await fetch(`${base}/card/moment/2/06:00.svg`)
    expect(live.headers.get('cache-control')).toBe('public, max-age=300')
  })
})

describe('a person’s own card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-agent-card-'))
  const site = join(dir, 'site')
  const SPRITE: [number, number, number] = [0xdc, 0x28, 0x5a]
  let gw: Gateway
  let base: string

  const CELL = 128
  const ATLAS = { w: CELL * 2, h: CELL }
  const MANIFEST = JSON.stringify({
    version: 'v4-hires-atlas',
    figureH: CELL,
    cells: {
      'idle-sw': { x: 0, y: 0, w: CELL, h: CELL, feetX: 64, feetY: 127 },
      'idle-se': { x: CELL, y: 0, w: CELL, h: CELL, feetX: 64, feetY: 127 },
    },
  })
  function markedAtlas(): RawImage {
    const img: RawImage = {
      width: ATLAS.w,
      height: ATLAS.h,
      data: new Uint8ClampedArray(ATLAS.w * ATLAS.h * 4),
    }
    for (let y = 0; y < CELL; y++)
      for (let x = CELL; x < CELL * 2; x++) img.data.set([...SPRITE, 255], (y * ATLAS.w + x) * 4)
    return img
  }

  beforeAll(async () => {
    mkdirSync(site)
    writeFileSync(join(site, 'index.html'), INDEX_HTML)
    const dbPath = join(dir, 'world.db')
    openForgeDb(dbPath).close()
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('agent-card-test'),
      snapshotEveryTicks: 25,
      onTick: ({ tick, emit }) => {
        if (tick !== 1) return
        emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        emit('agent_spawned', { id: 'bob', name: 'Bob', x: 1, y: 0, ageDays: ADULT_AGE_DAYS })
      },
    })
    for (let i = 0; i < 5; i++) loop.step()

    const codex = new AssetCodex(db)
    codex.register({
      class: 'rig-part',
      desc: 'character:bob',
      kind: 'character:bob',
      meta: MANIFEST,
      footprint: { w: 1, h: 1 },
      png: await encodePng(markedAtlas()),
      widthPx: ATLAS.w,
      heightPx: ATLAS.h,
      status: 'ready',
      score: 9,
      attempts: 1,
      costUsd: 0,
    })
    // Alice's sheet is the built placeholder shape: ready, and with no v4 manifest to crop by.
    codex.register({
      class: 'rig-part',
      desc: 'character:alice',
      kind: 'character:alice',
      footprint: { w: 1, h: 1 },
      png: await encodePng(markedAtlas()),
      widthPx: ATLAS.w,
      heightPx: ATLAS.h,
      status: 'ready',
      score: 9,
      attempts: 1,
      costUsd: 0,
    })

    const narratorPath = join(dir, 'narrator.db')
    const ndb = new Database(narratorPath)
    ndb.exec(NARRATOR_DDL)
    ndb
      .prepare(
        'INSERT INTO publications (day, kind, title, body, citations, subject_id) VALUES (?,?,?,?,?,?)',
      )
      .run(7, 'biography', 'Alice', 'Alice dug the first well. Then she slept.', null, 'alice')
    ndb.close()

    gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      narratorDbPath: narratorPath,
      staticDir: site,
    })
    base = `http://127.0.0.1:${gw.port}`
  })

  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('gives `/agent/:id` its own tags, pointing at that person’s card', async () => {
    const html = await (await fetch(`${base}/agent/alice`)).text()
    expect(html).toContain('<meta property="og:title" content="Alice — San Junipero"')
    expect(html).toContain(`<meta property="og:image" content="${base}/card/agent/alice.png" />`)
    expect(html).toContain(`<meta property="og:image:width" content="${CARD_WIDTH}" />`)
    // The life the town wrote, one sentence of it, verbatim — nothing composed about a person.
    expect(html).toContain('Alice dug the first well.')
    expect(html).not.toContain('Then she slept.')
  })

  it('★ says the town no longer has them, rather than handing back the whole town', async () => {
    const res = await fetch(`${base}/agent/nobody`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Someone the town no longer has — San Junipero')
    expect(html).toContain('<meta property="og:type" content="profile" />')
    expect(html).toContain('/agent/nobody" />')
    expect((await fetch(`${base}/card/agent/nobody.png`)).status).toBe(404)
    expect((await fetch(`${base}/card/agent/__proto__.svg`)).status).toBe(404)
  })

  it('★ marks a person up as a Person, with their own name', async () => {
    const html = await (await fetch(`${base}/agent/alice`)).text()
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? ''
    const graph = JSON.parse(ld.replace(/\\u003c/g, '<')) as Record<string, unknown>
    expect(graph['@type']).toBe('Person')
    expect(graph.name).toBe('Alice')
  })

  it('draws the person, and rasterizes the same card for a chat thread', async () => {
    const svg = await (await fetch(`${base}/card/agent/alice.svg`)).text()
    expect(svg).toContain('Alice')
    expect(svg).toContain('Alice dug the first well.')

    const res = await fetch(`${base}/card/agent/alice.png`)
    expect(res.headers.get('content-type')).toBe('image/png')
    const img = await decodePng(Buffer.from(await res.arrayBuffer()))
    expect([img.width, img.height]).toEqual([CARD_WIDTH, CARD_HEIGHT])
  })

  it('puts the forge’s own atlas on the card of somebody who has one', async () => {
    const svg = await (await fetch(`${base}/card/agent/bob.svg`)).text()
    expect(svg).toContain('data:image/png;base64,')
    expect(svg).toContain('Bob')
    expect(svg).toContain(TOWN_NAME) // no life written for Bob, and the card invents none

    const png = await (await fetch(`${base}/card/agent/bob.png`)).arrayBuffer()
    const img = await decodePng(Buffer.from(png))
    const i = (250 * img.width + 150) * 4 // inside the sprite box
    expect([img.data[i], img.data[i + 1], img.data[i + 2]]).toEqual(SPRITE)
  })

  it('leaves a sheet with no atlas manifest as type, never a test pattern', async () => {
    expect(await (await fetch(`${base}/card/agent/alice.svg`)).text()).not.toContain('<image')
  })
})
