// Overflow probe for the pre-launch UI review. Not shipped.
import { chromium } from '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const W = Number(process.env.W ?? 390)
const ARM = process.env.ARM ?? 'Folk'
const TAB = process.env.TAB ?? 'Bonds'

const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const p = await (await b.newContext({ viewport: { width: W, height: 844 } })).newPage()
await p.goto('http://127.0.0.1:8109/', { waitUntil: 'load' })
await p.waitForTimeout(5000)
await p.getByRole('button', { name: new RegExp(`^${ARM}$`) }).first().click()
await p.waitForTimeout(1000)
await p.getByRole('tab', { name: TAB, exact: true }).click()
await p.waitForTimeout(2500)
const out = await p.evaluate(() => {
  const sheet = document.querySelector('.paper-sheet')
  if (sheet === null) return { err: 'no sheet' }
  const cw = sheet.clientWidth
  const sr = sheet.getBoundingClientRect()
  const bad = []
  const probe = (el) => {
    const prev = el.style.cssText
    el.style.width = 'min-content'
    const mc = el.getBoundingClientRect().width
    el.style.cssText = prev
    return Math.round(mc)
  }
  for (const el of sheet.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width > cw + 1) {
      const cn = (el.className?.baseVal ?? el.className ?? '').toString()
      bad.push({ sel: `${el.tagName}.${cn.slice(0, 34)}`, w: Math.round(r.width), minContent: probe(el) })
    }
  }
  bad.sort((a, b) => b.minContent - a.minContent)
  return { cw, scrollW: sheet.scrollWidth, bad: bad.slice(0, 14) }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
