// Timing habits: a performance that is late on every string change is reported as such.
// Needs the dev server on port 5173 and the sample tab. `node timing.mjs`
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { synthesize } from '../src/practice/synth.ts'

const out = new URL('.', import.meta.url).pathname
const URL_APP = 'http://localhost:5173/'
const SAMPLE = new URL('../samples/californication.gp', import.meta.url).pathname
const RATE = 48000
const LEAD = 8
const BAR = 3840
const DRAG_SEC = 0.04
const first = 8 * BAR, end = 16 * BAR
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
function writeWav(file, samples) {
  const data = Buffer.alloc(44 + samples.length * 2)
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  fs.writeFileSync(file, data)
}
async function openSong(_owner, context) {
  const page = await context.newPage()
  await page.goto(URL_APP)
  await page.waitForSelector('.library')
  // Already in the library on a later go.
  const known = await page.$('.library .song-open, .library .song-row button')
  if (known) await known.click()
  else await page.setInputFiles('input[type=file]', SAMPLE)
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.click('.track:nth-child(1) .track-name')
  await page.waitForTimeout(1200)
  await page.evaluate(({ first, end }) => { window.__riffmaster.api().playbackRange = { startTick: first, endTick: end } }, { first, end })
  await page.waitForTimeout(300)
  return page
}

// What the tab expects, read from the app.
const reader = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const readPage = await openSong(reader, await reader.newContext({ viewport: { width: 1280, height: 800 } }))
const beats = await readPage.evaluate(() => window.__riffmaster.expected(0, 1))
await reader.close()
const startMs = beats[0].timeMs - (beats[0].tick - first) * (60000 / (96 * 960))
const single = beats.filter((beat, i) => i > 0 && beat.string !== null && beats[i - 1].string !== null)
const changes = single.filter((beat) => beat.string !== beats[beats.indexOf(beat) - 1].string).length
console.log(`      ${beats.length} beats, ${changes} string changes, ${single.length - changes} on one string`)
const seconds = ((end - first) / (96 * 960)) * 60
const notes = []
beats.forEach((beat, i) => {
  const crossed = i > 0 && beat.string !== null && beats[i - 1].string !== null && beat.string !== beats[i - 1].string
  const at = LEAD + (beat.timeMs - startMs) / 1000 + (crossed ? DRAG_SEC : 0)
  for (const midi of beat.midi) notes.push({ timeSec: at, midi, durationSec: 0.9 })
})
notes.sort((a, b) => a.timeSec - b.timeSec)
const wav = `${out}take-timing.wav`
writeWav(wav, synthesize(notes, RATE, LEAD + seconds + 4, { noiseFloor: 0.001 }))

// Three separate goes, in one browser profile so the history carries over.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'riffmaster-timing-'))
const errors = []
let summary = ''
let habits = ''
let stored = null
for (let go = 1; go <= 3; go++) {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: '/usr/bin/brave-browser', headless: true, viewport: { width: 1280, height: 800 }, permissions: ['microphone'],
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  })
  context.on('page', (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && errors.push(m.text())) })
  const page = await openSong(context, context)
  const opened = Date.now()
  await page.click('button[title="Practice"]')
  await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })
  const countIn = (4 * 60) / 96
  await page.waitForTimeout(Math.max(0, (LEAD - countIn - 0.75) * 1000 - (Date.now() - opened)))
  await page.click('.practice .button.primary')
  await page.waitForSelector('.practice-results', { timeout: (countIn + seconds + 10) * 1000 })
  await page.waitForTimeout(800)
  summary = (await page.textContent('.practice-results')).replace(/\s+/g, ' ')
  await page.click('.practice button:has-text("History")')
  await page.waitForSelector('.timing-habits')
  habits = (await page.textContent('.timing-habits')).replace(/\s+/g, ' ')
  if (go === 1) check('one go is not called a habit', /Nothing stands out/.test(habits) && !/You drag/.test(summary), habits.slice(0, 70))
  stored = await page.evaluate(() => new Promise((resolve) => {
    indexedDB.databases().then(([info]) => {
      const open = indexedDB.open(info.name)
      open.onsuccess = () => {
        const all = open.result.transaction('takes').objectStore('takes').getAll()
        all.onsuccess = () => resolve(all.result.map((take) => take.timing))
      }
    })
  }))
  await context.close()
}
fs.rmSync(profile, { recursive: true, force: true })
check('three goes were kept as three', new Set(stored.map((timing) => timing?.sitting)).size === 3, `${stored.length} takes`)
check('the take was heard', /(9\d|100)%/.test(summary), summary.slice(0, 60))
check('the result names the habit', /In your recent takes: You drag string changes/.test(summary), (summary.match(/You [^.]*\./) ?? ['none'])[0])
const ms = Number(habits.match(/about (\d+) ms late/)?.[1])
check('the history shows it, about the right size', ms >= 30 && ms <= 50, habits.slice(0, 110))
check('no delay from the beat is claimed', stored.every((timing) => timing?.bias === undefined))
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
