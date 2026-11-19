// Starting and stopping practice takes, including during the count-in:
// the cursor must stay, and each count-in must click once per beat.
// `node practice-restart.mjs` with the dev server on 5199 (or APP_URL).
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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => {
  // Records the loudness of everything sent to the speakers, every 10 ms.
  const connect = AudioNode.prototype.connect
  const analysers = []
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode) {
      const analyser = target.context.createAnalyser()
      analyser.fftSize = 2048
      analysers.push(analyser)
      connect.call(this, analyser)
    }
    return connect.call(this, target, ...rest)
  }
  window.__trace = []
  setInterval(() => {
    let peak = 0
    for (const analyser of analysers) {
      if (analyser.context.state === 'closed') continue
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      for (const v of data) peak = Math.max(peak, Math.abs(v))
    }
    window.__trace.push([performance.now(), peak])
  }, 10)
})
await page.goto(APP)
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 90000 })
await page.click('.track:nth-child(5) .track-name')
await page.waitForTimeout(1500)
await page.click('button[title="Practice"]')
await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })

const cursor = () =>
  page.evaluate(() => {
    const c = document.querySelector('.at-cursor-beat')
    if (!c) return 'none'
    const r = c.getBoundingClientRect()
    const style = getComputedStyle(c)
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0' && style.display !== 'none' ? 'shown' : 'hidden'
  })
/** Clicks heard between two page times: rises of the loudness above a threshold. */
const onsets = (from, to) =>
  page.evaluate(
    ([from, to]) => {
      const found = []
      let loud = false
      for (const [t, peak] of window.__trace) {
        if (t < from || t > to) continue
        if (!loud && peak > 0.05) found.push(Math.round(t - from))
        loud = peak > 0.02
      }
      return found
    },
    [from, to],
  )
const now = () => page.evaluate(() => performance.now())
const start = () => page.click('.practice .button.primary')
const stop = () => page.click('.practice .button.primary')
const waitIdle = () => page.waitForFunction(() => /Start/.test(document.querySelector('.practice .button.primary')?.textContent ?? ''), null, { timeout: 15000 })

// One bar of count-in at 96 bpm: 4 clicks in 2.5 s.
for (const [round, stopAfter] of [[1, 4000], [2, 1200], [3, 4000], [4, 300], [5, 4000]]) {
  const t0 = await now()
  await start()
  await page.waitForTimeout(stopAfter)
  const times = await onsets(t0, t0 + stopAfter)
  // The clicks are a beat (625 ms) apart; the song follows the fourth.
  const first = times[0] ?? 0
  const heard = times.filter((t) => t - first < 625 * 3.5).length
  await stop()
  await waitIdle().catch(() => {})
  await page.waitForTimeout(1500)
  // A clear result panel, if any, is dismissed so Start shows again.
  await page.click('text=Clear results').catch(() => {})
  await page.waitForTimeout(300)
  const expected = stopAfter >= 2450 ? 4 : null
  if (expected) check(`take ${round}: the count-in clicks ${expected} times`, heard === expected, `heard at ${times.slice(0, 6).join(', ')} ms`)
  else console.log(`      take ${round}: stopped after ${stopAfter} ms, ${heard} clicks heard`)
  check(`take ${round}: the cursor is shown after stopping`, (await cursor()) === 'shown', await cursor())
}
// A take stopped during its count-in, then the panel closed and the song
// played without a count-in: it must start at once, not count in first.
await start()
await page.waitForTimeout(500)
await stop()
await waitIdle().catch(() => {})
await page.waitForTimeout(1500)
await page.click('text=Clear results').catch(() => {})
await page.click('button[title="Practice"]')
await page.waitForTimeout(500)
const pressed = (title) => page.$eval(`button[title="${title}"]`, (b) => b.getAttribute('aria-pressed') === 'true')
if (await pressed('Count-in')) await page.click('button[title="Count-in"]')
const cursorX = () => page.evaluate(() => Math.round(document.querySelector('.at-cursor-beat')?.getBoundingClientRect().x ?? NaN))
const x0 = await cursorX()
await page.click('.play')
await page.waitForTimeout(1200)
const x1 = await cursorX()
check('after a count-in cut short, Play without count-in starts the song at once', x1 > x0, `cursor ${x0} -> ${x1}`)
await page.waitForTimeout(800)
check('after practice, normal playback shows the cursor', (await cursor()) === 'shown', await cursor())
await page.click('.play')
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
