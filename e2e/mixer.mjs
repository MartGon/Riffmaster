// Browser checks for the master volume, the per-track volumes and the app's name.
// Needs the dev server on port 5199. `node mixer.mjs`
import { chromium } from 'playwright-core'

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://localhost:5199/')
await page.waitForSelector('.library')
check('the app is called RiffMaster', (await page.title()) === 'RiffMaster' && (await page.textContent('.brand')) === 'RiffMaster')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })

const master = '.master-volume input'
const bass = 'input[aria-label^="Volume of"][aria-label*="Bass"]'
const read = () =>
  page.evaluate(() => ({
    master: document.querySelector('.master-volume .volume-value').textContent,
    bass: [...document.querySelectorAll('.track')].find((e) => e.textContent.includes('Bass')).querySelector('.volume-value').textContent,
    player: window.__riffmaster.api().masterVolume,
  }))
await page.waitForSelector('.track-volume input')
const sliders = (await page.$$('.track-volume input')).length
check('there is a master volume and one volume per track', (await page.$(master)) !== null && sliders === (await page.$$('.tracks .track')).length, `${sliders} sliders`)
// Each arrow press moves a slider by 5%.
await page.focus(master)
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
await page.focus(bass)
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
await page.waitForTimeout(300)
const shown = await read()
check('moving the sliders changes the volumes', shown.master === '80%' && shown.bass === '130%' && Math.abs(shown.player - 0.8) < 0.001, JSON.stringify(shown))

// Both are remembered: the master for this device, the track volume with the song.
await page.waitForTimeout(800)
await page.click('.topbar .button')
await page.waitForSelector('.song-open')
await page.reload()
await page.waitForSelector('.song-open')
await page.click('.song-open')
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.waitForTimeout(800)
const again = await read()
check('volumes are remembered after reopening', again.master === '80%' && again.bass === '130%' && Math.abs(again.player - 0.8) < 0.001, JSON.stringify(again))
await page.dblclick(bass)
await page.waitForTimeout(200)
const reset = (await read()).bass
check('double-clicking a track slider resets it to 100%', reset === '100%', reset)
await page.screenshot({ path: new URL('mixer.png', import.meta.url).pathname, clip: { x: 0, y: 50, width: 260, height: 600 } })
check('no errors', errors.length === 0, errors.join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
