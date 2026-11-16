// Choosing bars by tapping, on a phone-sized touch screen.
// Needs the dev server on port 5199. `node select.mjs`
import { chromium } from 'playwright-core'

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://localhost:5199/')
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.click('.tracks-toggle')
await page.click('.track:nth-child(5) .track-name')
await page.waitForTimeout(1500)

/** Page coordinates of the middle of a bar (0-based), scrolled into view. */
async function barPoint(bar) {
  return page.evaluate((index) => {
    const api = window.__riffmaster.api()
    for (const system of api.boundsLookup.staffSystems) {
      for (const masterBar of system.bars) {
        if (masterBar.index !== index) continue
        const box = masterBar.realBounds
        const score = document.querySelector('.score')
        const viewport = document.querySelector('.viewport')
        viewport.scrollTop = box.y - 40
        const rect = score.getBoundingClientRect()
        return { x: rect.left + box.x + box.w / 2, y: rect.top + box.y + box.h / 2 }
      }
    }
    return null
  }, bar)
}

const row = await page.evaluate(() => {
  const r = document.querySelector('.transport-row:last-child')
  return { rowHeight: r.getBoundingClientRect().height, buttons: r.querySelectorAll('.toggle').length }
})
await page.tap('button[aria-label="Select bars"]')
check('Select bars asks for the first bar', /Tap the first bar/.test(await page.textContent('.picking-hint')))
let point = await barPoint(2)
await page.waitForTimeout(200)
await page.touchscreen.tap(point.x, point.y)
await page.waitForTimeout(400)
check('after the first tap it asks for the last bar', /Bar 3\. Now tap the last bar/.test(await page.textContent('.picking-hint')))
point = await barPoint(4)
await page.waitForTimeout(200)
await page.touchscreen.tap(point.x, point.y)
await page.waitForTimeout(600)
const range = await page.evaluate(() => window.__riffmaster.range())
check('the bars from the first to the last tap are selected', range?.startTick === 2 * 3840 && range?.endTick > 4.9 * 3840 && range?.endTick <= 5 * 3840, JSON.stringify(range))
check('the hint goes away', (await page.$('.picking-hint')) === null)
check('the button now clears the selection', (await page.$('button[title="Clear selection"]')) !== null)
const after = await page.evaluate(() => {
  const r = document.querySelector('.transport-row:last-child')
  return { rowHeight: r.getBoundingClientRect().height, buttons: r.querySelectorAll('.toggle').length }
})
check('the button row does not grow', after.rowHeight === row.rowHeight && after.buttons === row.buttons, `${JSON.stringify(row)} → ${JSON.stringify(after)}`)
// Picking the bars the other way round, and a single bar.
await page.tap('button[title="Clear selection"]')
await page.tap('button[aria-label="Select bars"]')
point = await barPoint(6)
await page.touchscreen.tap(point.x, point.y)
await page.waitForTimeout(400)
await page.touchscreen.tap(point.x, point.y)
await page.waitForTimeout(600)
const single = await page.evaluate(() => window.__riffmaster.range())
check('tapping one bar twice selects just that bar', single?.startTick === 6 * 3840 && single?.endTick <= 7 * 3840, JSON.stringify(single))
await page.tap('button[title="Loop"]')
check('Loop can then be turned on', (await page.$eval('button[title="Loop"]', (e) => e.getAttribute('aria-pressed'))) === 'true')
await page.screenshot({ path: new URL('select-phone.png', import.meta.url).pathname })
check('no errors', errors.length === 0, errors.join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
