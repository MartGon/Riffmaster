// The iPhone failure: Safari's engine can refuse alphaTab's audio processor on the
// first Play ("No ScriptProcessor was registered with this name"), because the
// processor registers a moment after its file has loaded. Chromium does not, so
// here the first attempt is made to fail the same way, and playback must still start.
// `node worklet-retry.mjs [url]`, against the built app (see README) or the dev server.
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5198/'
const file = new URL('formats/guitarpro7-serenade.gp', import.meta.url).pathname
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
for (const failures of [1, 2, 4]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await context.addInitScript((count) => {
    const Real = window.AudioWorkletNode
    let left = count
    window.__workletAttempts = 0
    window.AudioWorkletNode = class extends Real {
      constructor(ctx, name, options) {
        if (name === 'alphatab') window.__workletAttempts++
        if (name === 'alphatab' && left > 0) {
          left--
          throw new DOMException('No ScriptProcessor was registered with this name', 'InvalidStateError')
        }
        super(ctx, name, options)
      }
    }
  }, failures)
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForSelector('.library')
  await page.setInputFiles('input[type=file]', file)
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 30000 })
  await page.tap('.play')
  const moved = await page
    .waitForFunction(() => !['0:00', undefined].includes(document.querySelector('.seek .time')?.textContent), null, { timeout: 5000 })
    .then(() => true, () => false)
  const retries = (await page.evaluate(() => window.__workletAttempts)) - 1
  const notice = await page.$eval('.error[role=alert]', (e) => e.textContent).catch(() => null)
  if (failures <= 3) {
    check(`plays after ${failures} failed start${failures > 1 ? 's' : ''} of the audio worklet`, moved && retries === failures, `${retries} retries`)
    check('no error shown', notice === null, notice ?? '')
  } else {
    check('gives up after 3 tries and says so', !moved && retries === 3 && /could not start/.test(notice ?? ''), notice ?? 'no message')
  }
  await context.close()
}
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
