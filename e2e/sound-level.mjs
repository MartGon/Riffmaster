// Measures what actually reaches the speakers while the player plays: an
// exercise, then a song. `node sound-level.mjs` with the dev server on 5199
// (or APP_URL).
import { chromium } from 'playwright-core'

const APP = process.env.APP_URL ?? 'http://localhost:5199/'
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })

/** Every node connected to the speakers is also fed to an analyser, read by `__level()`. */
const tap = () => {
  const connect = AudioNode.prototype.connect
  const taps = new WeakMap()
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode) {
      let analyser = taps.get(target.context)
      if (!analyser) {
        analyser = target.context.createAnalyser()
        analyser.fftSize = 2048
        taps.set(target.context, analyser)
        ;(window.__analysers ??= []).push(analyser)
      }
      connect.call(this, analyser)
    }
    return connect.call(this, target, ...rest)
  }
  window.__level = () => {
    let peak = 0
    for (const analyser of window.__analysers ?? []) {
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      for (const v of data) peak = Math.max(peak, Math.abs(v))
    }
    return peak
  }
}

async function loudest(page, ms) {
  await page.click('.play')
  let peak = 0
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    peak = Math.max(peak, await page.evaluate(() => window.__level()))
    await page.waitForTimeout(50)
  }
  const time = await page.textContent('.seek .time')
  await page.click('.play')
  return { peak, time }
}

async function ready(page) {
  await page.waitForSelector('.play')
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0, null, { timeout: 30000 })
  await page.waitForTimeout(800)
}

async function open(page, kind) {
  if (kind === 'exercise') {
    await page.click('.library-buttons button:has-text("Exercises")')
    await page.waitForSelector('dialog[open] select[name=exercise]')
    await page.click('dialog[open] button[type=submit]')
  } else {
    await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
  }
  await ready(page)
}

// Each on its own, then one after the other in the same visit; 'song*' has
// the rhythm guitar soloed and the first track muted, which must not carry over.
for (const order of [['exercise'], ['song'], ['song', 'exercise'], ['exercise', 'song'], ['song*', 'exercise']]) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.addInitScript(tap)
  await page.goto(APP)
  await page.waitForSelector('.library')
  for (const [at, kind] of order.entries()) {
    if (at > 0) {
      await page.click('.topbar .button')
      await page.waitForSelector('.library-head')
    }
    await open(page, kind.replace('*', ''))
    if (kind === 'song*') {
      await page.click('.track:nth-child(5) button[title="Solo"]')
      await page.click('.track:nth-child(1) button[title="Mute"]')
    }
    const { peak, time } = await loudest(page, 4000)
    check(`${order.slice(0, at + 1).join(' then ')}: playback is audible`, peak > 0.01, `peak ${peak.toFixed(4)}, at ${time}`)
  }
  if (errors.length) console.log('      errors:', errors.slice(0, 3).join(' | ').slice(0, 300))
}
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
