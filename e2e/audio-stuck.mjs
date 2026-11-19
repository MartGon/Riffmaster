// The audio output gets stuck (simulated: loading alphaTab's audio module
// never finishes, as can happen on an iPhone after the screen locks). The
// player must notice that nothing is heard, set the audio up again, and
// play once more from where it was. `node audio-stuck.mjs` with the dev
// server on 5199 (or APP_URL).
import { chromium } from 'playwright-core'

const APP = process.env.APP_URL ?? 'http://localhost:5199/'
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => {
  // Taps everything sent to the speakers, and can make module loads hang.
  window.__hang = false
  const addModule = AudioWorklet.prototype.addModule
  AudioWorklet.prototype.addModule = function (...args) {
    return window.__hang ? new Promise(() => {}) : addModule.apply(this, args)
  }
  const connect = AudioNode.prototype.connect
  window.__analysers = []
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode) {
      const analyser = target.context.createAnalyser()
      window.__analysers.push(analyser)
      connect.call(this, analyser)
    }
    return connect.call(this, target, ...rest)
  }
  window.__level = () => {
    let peak = 0
    for (const analyser of window.__analysers) {
      if (analyser.context.state === 'closed') continue
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      for (const v of data) peak = Math.max(peak, Math.abs(v))
    }
    return peak
  }
})
await page.goto(APP)
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
const playable = () => page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 90000 })
await playable()
await page.waitForTimeout(800)

const listen = async (ms) => {
  let peak = 0
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    peak = Math.max(peak, await page.evaluate(() => window.__level()))
    await page.waitForTimeout(50)
  }
  return peak
}
const seconds = async () => {
  const [m, s] = (await page.textContent('.seek .time')).split(':').map(Number)
  return m * 60 + s
}

await page.click('.play')
check('plays at first', (await listen(3000)) > 0.01)
await page.click('.play')
const at = await seconds()

// From now on the output gets stuck on its next Play.
await page.evaluate(() => (window.__hang = true))
await page.click('.play')
const noticed = await page
  .waitForFunction(() => /set up again/.test(document.querySelector('.error')?.textContent ?? ''), null, { timeout: 8000 })
  .then(() => true, () => false)
check('notices that nothing is heard and sets the sound up again', noticed, (await page.textContent('.error').catch(() => '')) ?? '')
check('Play shows as stopped meanwhile', (await page.$eval('.play', (e) => e.getAttribute('aria-label'))) === 'Play')
await page.evaluate(() => (window.__hang = false))
const ready = await playable().then(() => true, () => false)
check('becomes playable again', ready)
await page.waitForTimeout(500)
check('keeps the position', Math.abs((await seconds()) - at) <= 1, `${at}s before, ${await seconds()}s after`)
await page.click('.play')
const peak = await listen(3000)
check('plays again after the rebuild', peak > 0.01, `peak ${peak.toFixed(3)}`)
check('and moves on from there', (await seconds()) >= at + 2, `at ${await seconds()}s`)
await page.click('.play')
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
