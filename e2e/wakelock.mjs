// The screen stays on while a song is open: a screen wake lock is held in the player,
// let go in the library, and asked for again when the page comes back from the
// background. The browser's wake lock is replaced by a stand-in that records calls.
// `node wakelock.mjs [url]` (dev server or built app).
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5199/'
const file = new URL('formats/guitarpro7-serenade.gp', import.meta.url).pathname
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addInitScript(() => {
  window.__locks = []
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async (type) => {
        const sentinel = { type, released: false, release: async () => { sentinel.released = true } }
        window.__locks.push(sentinel)
        return sentinel
      },
    },
  })
  // Lets the check pretend the page went to the background, as the system does.
  window.__setVisibility = (state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    if (state === 'hidden') for (const lock of window.__locks) lock.released = true
    document.dispatchEvent(new Event('visibilitychange'))
  }
})
const page = await context.newPage()
const held = () => page.evaluate(() => window.__locks.filter((lock) => !lock.released).length)
const asked = () => page.evaluate(() => window.__locks.length)

await page.goto(url)
await page.waitForSelector('.library')
await page.waitForTimeout(300)
check('no lock in the library', (await asked()) === 0)

await page.setInputFiles('input[type=file]', file)
await page.waitForSelector('.score svg', { timeout: 30000 })
await page.waitForTimeout(300)
check('one lock while a song is open', (await held()) === 1, `${await held()} held`)
await page.tap('.score')
await page.waitForTimeout(200)
check('tapping does not ask for a second one', (await asked()) === 1, `${await asked()} asked`)

await page.evaluate(() => window.__setVisibility('hidden'))
await page.evaluate(() => window.__setVisibility('visible'))
await page.waitForTimeout(200)
check('asked for again after coming back from the background', (await held()) === 1 && (await asked()) === 2, `${await held()} held, ${await asked()} asked`)

await page.click('button:has-text("Library")')
await page.waitForSelector('.library')
await page.waitForTimeout(200)
check('let go back in the library', (await held()) === 0, `${await held()} held`)

await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
