// Lead-in: selected bars start one bar early, and that bar is not scored.
// Needs the dev server on port 5173 and `node expected.mjs` run first. `node leadin.mjs`
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'

const out = new URL('.', import.meta.url).pathname
const RATE = 48000
const LEAD = 8
const BAR = 3840
const TICKS_PER_SEC = (96 * 960) / 60
const expectedAll = JSON.parse(fs.readFileSync(`${out}expected.json`))
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
function writeWav(path, samples) {
  const data = Buffer.alloc(44 + samples.length * 2)
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  fs.writeFileSync(path, data)
}

// Bars 9 and 10 twice, the run-up bar 9 played wrongly: it must not count.
const first = 8 * BAR, sel = 9 * BAR, end = 10 * BAR
const loopSec = (end - first) / TICKS_PER_SEC
const beats = expectedAll[0].filter((n) => n.tick >= first && n.tick < end)
const startMs = (first / TICKS_PER_SEC) * 1000
const notes = []
for (let pass = 0; pass < 2; pass++) {
  for (const beat of beats) {
    const at = LEAD + pass * loopSec + (beat.timeMs - startMs) / 1000
    // A fourth off: wrong notes all through the run-up.
    const off = beat.tick < sel ? 5 : 0
    for (const midi of beat.midi) notes.push({ timeSec: at, midi: midi + off, durationSec: 1.2 })
  }
}
notes.sort((a, b) => a.timeSec - b.timeSec)
const wav = `${out}take-leadin.wav`
writeWav(wav, synthesize(notes, RATE, LEAD + 2 * loopSec + 5, { noiseFloor: 0.001 }))

const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] })).newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://localhost:5173/')
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.click('.track:nth-child(1) .track-name')
await page.waitForTimeout(1200)
const range = () => page.evaluate(() => window.__riffmaster.range())
const tick = () => page.evaluate(() => window.__riffmaster.api().tickPosition)
await page.click('button[title="Loop"]')
await page.evaluate(({ sel, end }) => { window.__riffmaster.api().playbackRange = { startTick: sel, endTick: end } }, { sel, end })
await page.waitForTimeout(300)
await page.click('button[title^="Lead-in"]')
check('the setting is remembered', await page.evaluate(() => JSON.parse(localStorage.getItem('riffmaster.prefs')).leadIn === true))

// Plain Play.
await page.click('.play')
await page.waitForTimeout(700)
const early = await tick()
check('Play starts in the bar before the selection', early >= first && early < sel, String(early))
await page.waitForFunction((sel) => window.__riffmaster.api().tickPosition > sel + 500, sel, { timeout: 8000 })
await page.waitForFunction((sel) => window.__riffmaster.api().tickPosition < sel, sel, { timeout: 8000 })
check('each loop runs up from the bar before again', (await tick()) >= first)
await page.waitForFunction((sel) => window.__riffmaster.api().tickPosition > sel + 800, sel, { timeout: 8000 })
await page.click('.play')
await page.waitForTimeout(500)
let now = await range()
const paused = await tick()
check('paused, the range is the selection again', now?.startTick === sel && now?.endTick === end, JSON.stringify(now))
check('paused, the position stays in the selection', paused > sel && paused < end, String(paused))
await page.click('.play')
await page.waitForTimeout(500)
const resumed = await tick()
check('resuming goes on from there', resumed >= paused - 5 && resumed < end, `${paused} -> ${resumed}`)
await page.waitForFunction((sel) => window.__riffmaster.api().tickPosition < sel, sel, { timeout: 8000 })
check('and the next pass has its run-up', (await tick()) >= first)
await page.click('button[aria-label="Stop"]')
await page.waitForTimeout(500)
now = await range()
check('stopped, the range is the selection again', now?.startTick === sel && now?.endTick === end, JSON.stringify(now))

// A take.
const opened = Date.now()
await page.click('button[title="Practice"]')
await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })
const countIn = (4 * 60) / 96
await page.waitForTimeout(Math.max(0, (LEAD - countIn - 0.75) * 1000 - (Date.now() - opened)))
await page.click('.practice .button.primary')
await page.waitForTimeout(countIn * 1000 + 700)
const inTake = await tick()
check('a take starts in the bar before the selection', inTake >= first && inTake < sel, String(inTake))
await page.waitForTimeout(2 * loopSec * 1000 + 700)
await page.click('.practice .button.primary')
await page.waitForSelector('.practice-results', { timeout: 10000 })
await page.waitForTimeout(800)
const text = (await page.textContent('.practice')).replace(/\s+/g, ' ')
const passes = (text.match(/(\d+) passes: ([\d%, ]+)/) ?? [])[2]?.split(', ').map((p) => Number(p.replace('%', ''))) ?? []
check('the run-up bar, played wrongly, costs nothing', passes.length >= 2 && passes[0] === 100 && passes[1] === 100, passes.join(', ') || text.slice(0, 120))
await page.click('.practice button:has-text("History")')
await page.waitForTimeout(400)
const row = (await page.$eval('.history table tbody tr', (e) => e.textContent).catch(() => '')).replace(/\s+/g, ' ')
check('the history counts only the selected bar', /10–10/.test(row), row)
now = await range()
check('after the take, the range is the selection', now?.startTick === sel && now?.endTick === end, JSON.stringify(now))
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
