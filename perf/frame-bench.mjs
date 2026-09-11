// Frame bench for the post chain. Serves perf/ to a headless chromium, renders the same scene
// with and without a pass, and prints ms a frame. Run it from the repo root:
//
//   node perf/frame-bench.mjs
//
// Flags: --w --h --sprites --samples --frames --port --angle --variants --keep
//
// It measures THIS box. This box has no GPU a browser may open (/dev/dri is not readable and no
// mesa driver is installed), so the renderer is ANGLE SwiftShader, a CPU rasteriser. Treat the
// absolute milliseconds as a fill-rate ranking, never as a laptop's frame time. What does carry
// over is the RATIO between two passes at the same resolution and the way a pass scales with
// pixel count, which is what a budget is argued with.
//
// `--probe=1` prints draw calls and framebuffer binds a frame instead of timing, which is the
// same on every box: sunny is 8 draws and 1 bind, a graded weather is 9 and 3.
// To price a new pass, add a variant in bench.js beside the blit ones, then name it in
// `--variants=`. `blit1`/`blit2`/`blit4` are the calibration: one alpha blended full screen
// sprite, so a pass can be quoted in full-screen passes and not only in this box's milliseconds.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PIXI = join(HERE, '../packages/web/node_modules/pixi.js/dist/pixi.min.mjs')
const CHROMIUM = '/snap/bin/chromium'

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const W = Number(arg('w', 2560))
const H = Number(arg('h', 1440))
const SPRITES = Number(arg('sprites', 400))
const SAMPLES = Number(arg('samples', 9))
const FRAMES = Number(arg('frames', 20))
const PORT = Number(arg('port', 9412))
const CDP = PORT + 1
const ANGLE = arg('angle', 'swiftshader-webgl')
const VARIANTS = arg('variants', 'empty,sunny,cloudy,rain,storm,snow').split(',')

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' }

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const file = path === '/pixi.mjs' ? PIXI : join(HERE, path === '/' ? 'bench.html' : path)
  readFile(file).then(
    (buf) => {
      res.writeHead(200, {
        'content-type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'text/plain',
      })
      res.end(buf)
    },
    () => {
      res.writeHead(404)
      res.end('no')
    },
  )
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const url = `http://127.0.0.1:${String(PORT)}/bench.html?w=${String(W)}&h=${String(H)}&sprites=${String(SPRITES)}`
// Snap confinement: chromium may only write its profile under its own snap directory, and it
// aborts on a SingletonLock it cannot create anywhere else.
const profile = mkdtempSync(
  join(process.env.HOME ?? tmpdir(), 'snap/chromium/common/chromium-headless/sj-bench-'),
)
const chrome = spawn(
  CHROMIUM,
  [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--noerrdialogs',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${String(CDP)}`,
    '--ozone-platform=headless',
    `--ozone-override-screen-size=${String(W)},${String(H)}`,
    `--window-size=${String(W)},${String(H)}`,
    `--use-angle=${ANGLE}`,
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    url,
  ],
  { stdio: 'ignore' },
)

const done = async (code) => {
  if (arg('keep', '') === '') chrome.kill('SIGTERM')
  server.close()
  await new Promise((r) => setTimeout(r, 200))
  process.exit(code)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageSocket() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(CDP)}/json/list`)).json()
      // The extension background page answers /json/list too, and it has no canvas.
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1'))
      if (page !== undefined) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await wait(200)
  }
  throw new Error('no page target on CDP')
}

const ws = new WebSocket(await pageSocket())
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true })
  ws.addEventListener('error', j, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  const p = pending.get(msg.id)
  if (p !== undefined) {
    pending.delete(msg.id)
    p(msg)
  }
})
const evaluate = async (expression) => {
  const id = ++seq
  const reply = new Promise((r) => pending.set(id, r))
  ws.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  )
  const msg = await reply
  if (msg.error !== undefined) throw new Error(JSON.stringify(msg.error))
  const r = msg.result.result
  if (msg.result.exceptionDetails !== undefined)
    throw new Error(JSON.stringify(msg.result.exceptionDetails))
  return r.value
}

for (let i = 0; ; i++) {
  const state = await evaluate(
    '({ ready: !!window.sjBenchReady, err: window.sjBenchError ?? null })',
  )
  if (state.err !== null) {
    console.error(state.err)
    await done(1)
  }
  if (state.ready) break
  if (i > 150) {
    console.error('bench page never became ready')
    await done(1)
  }
  await wait(200)
}

const info = await evaluate('window.sjBench.info')
if (arg('probe', '') !== '') {
  console.log(`\nrenderer   ${info.renderer} / ${info.gl}`)
  for (const name of VARIANTS) {
    const c = await evaluate(`window.sjBench.probe(${JSON.stringify(name)})`)
    console.log(
      `${name.padEnd(9)} draws ${String(c.draws).padStart(3)}  fbo binds ${String(c.binds).padStart(3)}  viewports ${c.viewports.join(' ')}`,
    )
  }
  await done(0)
}
const res = await evaluate(
  `window.sjBench.run({ names: ${JSON.stringify(VARIANTS)}, samples: ${String(SAMPLES)}, frames: ${String(FRAMES)} })`,
)

const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2
}
const f = (n) => n.toFixed(3).padStart(8)

console.log(`\nrenderer   ${info.renderer} / ${info.gl}`)
console.log(`viewport   ${String(info.size[0])}x${String(info.size[1])} at resolution 1`)
console.log(`scene      ${String(info.drawables)} drawables (${String(info.sprites)} bodies)`)
console.log(`sampling   ${String(SAMPLES)} samples x ${String(FRAMES)} frames, round robin\n`)
console.log('variant      median      min      max   spread    vs sunny')
const base = median(res['sunny'] ?? [])
for (const [name, arr] of Object.entries(res)) {
  const m = median(arr)
  const lo = Math.min(...arr)
  const hi = Math.max(...arr)
  const delta = res['sunny'] === undefined || name === 'sunny' ? '' : f(m - base)
  console.log(`${name.padEnd(9)}${f(m)} ${f(lo)} ${f(hi)} ${f(hi - lo)} ${delta}`)
}
console.log('\nraw ms a frame per sample:')
for (const [name, arr] of Object.entries(res))
  console.log(`${name.padEnd(9)}${arr.map((x) => x.toFixed(2)).join(' ')}`)
await done(0)
