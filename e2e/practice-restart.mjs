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
  window.__cursor = []
  setInterval(() => {
    let peak = 0
    for (const analyser of analysers) {
      if (analyser.context.state === 'closed') continue
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      for (const v of data) peak = Math.max(peak, Math.abs(v))
    }
    window.__trace.push([performance.now(), peak])
    const c = document.querySelector('.at-cursor-beat')
    window.__cursor.push([performance.now(), c ? Math.round(c.getBoundingClientRect().x) : null])
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

/** When the cursor first moves after a page time: the song has begun. */
const cursorMoves = (from) =>
  page.evaluate((from) => {
    const trace = window.__cursor.filter(([t, x]) => t >= from && x !== null)
    const x0 = trace[0]?.[1]
    return trace.find(([, x]) => x !== x0)?.[0] ?? null
  }, from)

// One bar of count-in at 96 bpm: 4 clicks, a beat (625 ms) apart, and the
// song a beat after the fourth. Take 2 follows one stopped mid-song, mid-bar.
for (const [round, stopAfter] of [[1, 6000], [2, 4000], [3, 1200], [4, 4000], [5, 300], [6, 4000]]) {
  if (round === 2)
    await page.evaluate(() => {
      // The positions reported until the song moves on: the seek to the take's start.
      window.__ticks = []
      const api = window.__riffmaster.api()
      const from = api.tickPosition
      api.playerPositionChanged.on((args) => {
        if (window.__ticks && args.isSeek) window.__ticks.push(args.currentTick)
      })
      window.__ticks.push(from)
    })
  const t0 = await now()
  await start()
  await page.waitForTimeout(stopAfter)
  const times = await onsets(t0, t0 + stopAfter)
  // Measured from the first click: the jump back to the bar's start moves it before that.
  const song = await cursorMoves(t0 + (times[0] ?? 0) + 50)
  await stop()
  await waitIdle().catch(() => {})
  await page.waitForTimeout(1500)
  // A clear result panel, if any, is dismissed so Start shows again.
  await page.click('text=Clear results').catch(() => {})
  await page.waitForTimeout(300)
  if (stopAfter >= 3500) {
    const first = t0 + (times[0] ?? 0)
    const countIn = song === null ? null : Math.round(song - first)
    // The song's first note sounds as the cursor moves off.
    const clicks = times.filter((t) => t0 + t < (song ?? Infinity) - 250).length
    check(
      `take ${round}: the count-in is one bar, 4 clicks`,
      clicks === 4 && countIn !== null && countIn > 2200 && countIn < 2900,
      `${clicks} clicks, song ${countIn} ms after the first; heard at ${times.slice(0, 7).join(', ')} ms`,
    )
  } else console.log(`      take ${round}: stopped after ${stopAfter} ms, clicks at ${times.join(', ')} ms`)
  if (round === 2) {
    // Stopped mid-bar, the take begins at the start of that same bar: no
    // position before the song may fall in the bar before it.
    const bars = await page.evaluate(() => {
      const api = window.__riffmaster.api()
      const bars = window.__ticks.map((tick) => api.tickCache.masterBars.findIndex((b) => tick >= b.start && tick < b.end))
      window.__ticks = null
      return bars.filter((bar, i) => i === 0 || bar !== bars[i - 1])
    })
    check('starting a take after a stop mid-bar, the position stays in its bar', bars.length === 1, `bars reported: ${bars.join(' -> ')}`)
  }
  check(`take ${round}: the cursor is shown after stopping`, (await cursor()) === 'shown', await cursor())
}
// Start pressed while the song plays: the take pauses it and counts in one
// bar from the start of the bar, the cursor standing still meanwhile.
await page.click('.play')
await page.waitForTimeout(3000)
{
  const t0 = await now()
  await start()
  await page.waitForTimeout(4500)
  // What is heard in the first moment is the song, still sounding as it is paused.
  const times = (await onsets(t0, t0 + 4500)).filter((t) => t > 60)
  const first = t0 + (times[0] ?? 0)
  const song = await cursorMoves(first + 50)
  const clicks = times.filter((t) => t0 + t < (song ?? Infinity) - 250).length
  const countIn = song === null ? null : Math.round(song - first)
  await stop()
  await waitIdle().catch(() => {})
  await page.waitForTimeout(1500)
  await page.click('text=Clear results').catch(() => {})
  await page.waitForTimeout(300)
  check(
    'a take started while the song plays counts in one bar, the cursor still',
    clicks === 4 && countIn !== null && countIn > 2200 && countIn < 2900,
    `${clicks} clicks, cursor first moves ${countIn} ms after the first; heard at ${times.slice(0, 7).join(', ')} ms`,
  )
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
await page.waitForTimeout(800)
// Paused mid-bar, Play without a count-in carries on from there.
const paused = await cursorX()
await page.click('.play')
await page.waitForTimeout(150)
const resumed = await cursorX()
check('without a count-in, Play carries on where it paused', resumed >= paused, `cursor ${paused} -> ${resumed}`)
await page.waitForTimeout(1300)
await page.click('.play')
await page.waitForTimeout(800)
// With a count-in, Play goes back to the start of the bar and counts in one bar, as a take does.
await page.click('button[title="Count-in"]')
const barX = () => page.evaluate(() => Math.round(document.querySelector('.at-cursor-bar')?.getBoundingClientRect().x ?? NaN))
// Halfway through the bar, as after a pause there.
await page.evaluate(() => {
  const api = window.__riffmaster.api()
  const bar = api.tickCache.masterBars.find((b) => api.tickPosition >= b.start && api.tickPosition < b.end)
  api.tickPosition = Math.round((bar.start + bar.end) / 2)
})
await page.waitForTimeout(500)
const midBar = await cursorX()
const barStart = await barX()
const t1 = await now()
await page.click('.play')
await page.waitForTimeout(4000)
const heard = await onsets(t1, t1 + 4000)
const backAt = await page.evaluate((from) => window.__cursor.find(([t]) => t > from + 300)?.[1], t1)
const songAt = await cursorMoves(t1 + (heard[0] ?? 0) + 50)
const clicks = heard.filter((t) => t1 + t < (songAt ?? Infinity) - 100).length
await page.click('.play')
check(
  'with a count-in, Play from mid-bar goes back to the start of the bar',
  // The first beat's cursor sits a little inside the bar line.
  midBar > barStart + 60 && backAt >= barStart && backAt - barStart < 30,
  `cursor ${midBar} -> ${backAt}, bar at ${barStart}`,
)
check(
  'with a count-in, Play from mid-bar counts in one bar, 4 clicks',
  clicks === 4 && songAt !== null && songAt - t1 - heard[0] > 2200 && songAt - t1 - heard[0] < 2900,
  `${clicks} clicks, song ${songAt === null ? null : Math.round(songAt - t1 - heard[0])} ms after the first; heard at ${heard.slice(0, 7).join(', ')} ms`,
)
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
