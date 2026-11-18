// Watches the beat cursor during the count-in of a practice take: it must
// stay on the first beat until the song itself starts, then move on.
import { chromium } from 'playwright-core'

const APP = process.env.APP_URL ?? 'http://localhost:5199/'
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] })
const page = await context.newPage()
await page.goto(APP)
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
await page.waitForSelector('.tracks .track', { timeout: 30000 })
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.click('.track:nth-child(5) .track-name')
await page.waitForTimeout(1500)
await page.click('button[title="Practice"]')
await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })

const cursorX = () => page.evaluate(() => Math.round(document.querySelector('.at-cursor-beat')?.getBoundingClientRect().x ?? NaN))
const before = await cursorX()
await page.click('.practice .button.primary')
// One bar of count-in at 96 bpm: 2.5 s.
const during = []
const t0 = Date.now()
while (Date.now() - t0 < 2300) {
  during.push(await cursorX())
  await page.waitForTimeout(100)
}
await page.waitForTimeout(2000)
const after = await cursorX()
check('cursor stays on the first beat during the count-in', during.every((x) => x === before), `at ${before}, seen ${[...new Set(during)].join(', ')}`)
check('cursor moves once the song starts', after > before + 50, `${before} -> ${after}`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
