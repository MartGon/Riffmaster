// Playback after the audio was suspended (as iOS does when the page goes to
// the background or the audio mode changes). `node wake.mjs`
import { chromium } from 'playwright-core'

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://localhost:5199/')
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.waitForTimeout(1000)
const position = () => page.$eval('input[aria-label="Position"]', (e) => Number(e.value))
const label = () => page.$eval('.play', (e) => e.getAttribute('aria-label'))
const contextState = () => page.evaluate(() => window.__riffmaster.api().player.output.context?.state)

// 1. Suspended while paused, then Play.
await page.click('.play')
await page.waitForTimeout(1000)
await page.click('.play')
await page.waitForTimeout(300)
await page.evaluate(() => window.__riffmaster.api().player.output.context.suspend())
await page.waitForTimeout(300)
check('the audio can be put to sleep for the test', (await contextState()) === 'suspended')
const before = await position()
await page.click('.play')
await page.waitForTimeout(1500)
check('Play wakes the audio and plays', (await contextState()) === 'running' && (await position()) > before + 500 && (await label()) === 'Pause', `${before} → ${await position()}`)

// 2. Suspended while playing: the tap wakes it instead of pausing.
await page.evaluate(() => window.__riffmaster.api().player.output.context.suspend())
await page.waitForTimeout(800)
check('with the audio asleep the button still says Pause', (await label()) === 'Pause')
await page.click('.play')
await page.waitForTimeout(1500)
const moving = await position()
await page.waitForTimeout(800)
check('a tap then wakes the audio instead of pausing', (await contextState()) === 'running' && (await position()) > moving && (await label()) === 'Pause')

// 3. Left asleep: playback is paused with a message after a few seconds.
await page.evaluate(() => window.__riffmaster.api().player.output.context.suspend())
await page.waitForTimeout(4500)
const message = await page.textContent('.error').catch(() => '')
check('a stall pauses playback and says so', (await label()) === 'Play' && /phone paused the sound/.test(message), message)
await page.click('.error .icon-button')
await page.click('.play')
await page.waitForTimeout(1500)
check('Play then goes on', (await label()) === 'Pause' && (await contextState()) === 'running')
await page.click('.play')

// 4. A long, slow count-in is not taken for a stall.
await page.click('button[title="Count-in"]')
for (let i = 0; i < 10; i++) await page.click('button[aria-label="Slower"]')
await page.click('.play')
await page.waitForTimeout(6500)
check('a slow count-in is not mistaken for a stall', (await label()) === 'Pause' && !(await page.$('.error')), `${await label()}`)
await page.click('.play')
check('no errors', errors.length === 0, errors.join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
