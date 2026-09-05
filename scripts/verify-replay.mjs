// Clicks a Chronicle entry in a real browser and proves the town replays rather than freezing.
// The one thing no unit test can say: the owner's actual gesture, end to end.
//
//   pnpm --dir /tmp/pw i playwright-core          # not a repo dependency on purpose
//   SJ_LIVE=0 PORT=8095 node --import tsx packages/town/src/serve.ts   # free, scripted cast
//   node scripts/verify-replay.mjs
//
// Two traps this hit the first time, both worth knowing before you debug the app:
//   * `vite build` writes new asset hashes, and serve.ts reads index.html ONCE at boot. A rebuild
//     without a server restart serves the old hashes and the page hangs on "Looking for the town".
//   * Screenshots time out against the animating Pixi canvas. Assert on the DOM and the socket.
import { chromium } from 'playwright-core'

const URL = process.env.TOWN_URL ?? 'http://localhost:8095/'
const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux/chrome`

const b = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

// Every frame the viewer sends, recorded before any app code runs.
await p.addInitScript(() => {
  window.__sent = []
  const send = WebSocket.prototype.send
  WebSocket.prototype.send = function (d) {
    try {
      window.__sent.push(String(d))
    } catch {}
    return send.call(this, d)
  }
})

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await p.waitForSelector('.signpost-arm', { timeout: 60_000 })
await p.waitForFunction(() => document.getElementById('first-frame') === null, { timeout: 60_000 })
await p.waitForTimeout(3000)

await p.locator('.signpost-arm:has-text("Chronicle")').dispatchEvent('click')
await p.waitForSelector('.paper[data-open="yes"]', { timeout: 30_000 })
await p.waitForTimeout(1500)

const before = await p.evaluate(() => window.__sent.length)
const row = p.locator('.paper button.feed-jump').nth(1)
console.log('clicking:', JSON.stringify((await row.textContent()).trim().slice(0, 60)))
await row.click({ timeout: 15_000 })
await p.waitForTimeout(2500)

const sent = await p.evaluate((k) => window.__sent.slice(k), before)
const marks = []
for (let i = 0; i < 8; i++) {
  marks.push(
    await p.evaluate(() => ({
      url: location.pathname,
      clock: (document.querySelector('[class*="stamp"]')?.textContent ?? '').trim(),
      paper: document.querySelector('.paper')?.getAttribute('data-open'),
    })),
  )
  await p.waitForTimeout(1000)
}
for (const m of marks) console.log('   ', JSON.stringify(m))

const replay = sent.filter((f) => f.includes('"t":"replay"'))
const scrub = sent.filter((f) => f.includes('"t":"scrub"'))
const clocks = [...new Set(marks.map((m) => m.clock).filter(Boolean))]
console.log('\nreplay frames:', replay.length, replay[0]?.slice(0, 70) ?? '')
console.log('scrub frames :', scrub.length)
console.log('paper closed :', marks[0]?.paper === 'no')
console.log('clocks seen  :', clocks.length, JSON.stringify(clocks.slice(0, 6)))

const played = replay.length > 0 && clocks.length > 1 && !clocks.every((c) => c.includes('LIVE'))
console.log(played ? 'PASS — it plays the past' : 'FAIL')
await b.close()
process.exit(played ? 0 : 1)
