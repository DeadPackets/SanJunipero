// Screenshot harness for the pre-launch UI review. Not shipped; run by hand against a
// SCRIPTED town (SJ_LIVE=0) on 8109.
import { chromium } from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SJ_URL ?? 'http://127.0.0.1:8109'
const OUT = process.env.SHOT_DIR ?? 'review-shots/before'
const SIZES = [
  { name: '1280', width: 1280, height: 800 },
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})

const notes = []

for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))

  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${OUT}/stage-${size.name}.png` })

  // horizontal overflow check
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))
  notes.push(`${size.name} stage overflow: ${JSON.stringify(overflow)}`)

  const arms = await page.locator('#signpost a, #signpost button').allTextContents()
  notes.push(`${size.name} arms: ${JSON.stringify(arms)}`)

  for (const arm of ['Folk', 'Chronicle', 'Found', 'Laws']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${arm}$`, 'i') }).first()
    if ((await btn.count()) === 0) {
      notes.push(`${size.name}: arm ${arm} not found`)
      continue
    }
    await btn.click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/paper-${arm.toLowerCase()}-${size.name}.png` })
    const tabs = await page.locator('[role="tab"]').allTextContents()
    notes.push(`${size.name} ${arm} tabs: ${JSON.stringify(tabs)}`)
    for (const tab of tabs) {
      const t = page.getByRole('tab', { name: tab, exact: true }).first()
      if ((await t.count()) === 0) continue
      await t.click()
      await page.waitForTimeout(900)
      const slug = tab.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      await page.screenshot({
        path: `${OUT}/paper-${arm.toLowerCase()}-${slug}-${size.name}.png`,
      })
      const of = await page.evaluate(() => {
        const s = document.querySelector('.paper-sheet')
        if (s === null) return null
        return { sw: s.scrollWidth, cw: s.clientWidth, sh: s.scrollHeight, ch: s.clientHeight }
      })
      notes.push(`${size.name} ${arm}/${tab} sheet: ${JSON.stringify(of)}`)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }

  // key map
  await page.keyboard.press('?')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/keymap-${size.name}.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  notes.push(`${size.name} console: ${errs.length === 0 ? 'clean' : errs.slice(0, 12).join(' | ')}`)
  await ctx.close()
}

// reduced motion pass at 1440
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForTimeout(5000)
  await page.screenshot({ path: `${OUT}/stage-reduced-1440.png` })
  await ctx.close()
}

await browser.close()
console.log(notes.join('\n'))
