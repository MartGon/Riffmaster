// Practice with Loop on, and practice starting from the playback position.
// A synthesized performance is fed in as the microphone, as in practice.mjs.
// Run `node expected.mjs` first. `node practice-loop.mjs loop|cursor|edge|all`
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'

const out = new URL('.', import.meta.url).pathname
const RATE = 48000
const LEAD = 8 // seconds of silence before the performance
const TICKS_PER_SEC = (96 * 960) / 60 // the test song's tempo
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

/**
 * Notes of the rhythm guitar between two ticks, played `passes` times in a
 * row; `skip` lists, per pass, the single notes left out.
 */
function perform({ fromTick, toTick, passes, skip = {}, seconds, track = 4 }) {
  const startMs = (fromTick / TICKS_PER_SEC) * 1000
  const loopMs = ((toTick - fromTick) / TICKS_PER_SEC) * 1000
  const beats = expectedAll[track].filter((n) => n.tick >= fromTick && n.tick < toTick)
  const single = beats.filter((n) => n.midi.length === 1)
  const notes = []
  for (let pass = 0; pass < passes; pass++) {
    for (const beat of beats) {
      const index = beat.midi.length === 1 ? single.indexOf(beat) : -1
      if (skip[pass]?.includes(index)) continue
      const at = LEAD + (pass * loopMs + beat.timeMs - startMs) / 1000
      if (at > LEAD + seconds) continue
      for (const midi of beat.midi) notes.push({ timeSec: at, midi, durationSec: 1.2 })
    }
  }
  notes.sort((a, b) => a.timeSec - b.timeSec)
  return { audio: synthesize(notes, RATE, LEAD + seconds + 4, { noiseFloor: 0.001 }), perPass: single.length }
}

async function open(wav, { trackRow = 5, leeway = 'normal' } = {}) {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/brave-browser',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] })).newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('http://localhost:5199/')
  await page.waitForSelector('.library')
  await page.evaluate((value) => localStorage.setItem('riffmaster.practice', JSON.stringify({ leeway: value })), leeway)
  await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.click(`.track:nth-child(${trackRow}) .track-name`)
  await page.waitForTimeout(1500)
  return { browser, page, errors }
}

/** Opens the practice panel and starts a take so that the song begins as the performance does. */
async function startInTime(page, opened) {
  const countIn = (4 * 60) / 96
  await page.waitForTimeout(Math.max(0, (LEAD - countIn - 0.75) * 1000 - (Date.now() - opened)))
  await page.click('.practice .button.primary')
}

async function loop() {
  // The Intro (bars 1-4) three times; the second time two notes are left out.
  const toTick = 15310
  const seconds = (3 * toTick) / TICKS_PER_SEC
  const { audio, perPass } = perform({ fromTick: 0, toTick, passes: 3, skip: { 1: [2, 6] }, seconds })
  const wav = `${out}take-loop.wav`
  writeWav(wav, audio)
  const { browser, page, errors } = await open(wav)
  await page.click('.section:nth-child(1) .chip') // select the Intro and turn Loop on
  await page.waitForTimeout(600)
  const opened = Date.now()
  await page.click('button[title="Practice"]')
  await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })
  await startInTime(page, opened)
  await page.waitForTimeout((4 * 60) / 96 * 1000 + 12_000)
  const during = await page.textContent('.practice').catch(() => '')
  check('loop: a second pass starts after the first', /Looping: pass 2/.test(during), (during.match(/Looping[^.]*(\.[^.]*)?/) ?? [''])[0])
  await page.waitForTimeout(19_000)
  const later = await page.textContent('.practice').catch(() => '')
  check('loop: the first passes are scored while it keeps going', /Finished passes: \d+%, \d+%/.test(later), (later.match(/Looping.*?%(, \d+%)*/) ?? [''])[0])
  await page.click('.practice .button.primary') // Stop
  await page.waitForSelector('.practice-results', { timeout: 10000 })
  await page.waitForTimeout(800)
  const text = (await page.textContent('.practice')).replace(/\s+/g, ' ')
  const passes = (text.match(/(\d+) passes: ([\d%, ]+)/) ?? [])[2]?.split(', ').map((p) => Number(p.replace('%', ''))) ?? []
  check('loop: the pass cut short by Stop is left out', passes.length === 3 && !passes.includes(0), passes.join(', '))
  check('loop: every pass is listed', passes.length >= 2, text.match(/\d+ passes: [\d%, ]+/)?.[0] ?? text.slice(0, 120))
  check('loop: the clean first pass scores 100%', passes[0] === 100, String(passes[0]))
  const second = Math.round(((perPass - 2) / perPass) * 100)
  check('loop: the second pass misses the two left-out notes', Math.abs(passes[1] - second) <= 1, `${passes[1]}%, expected ${second}%`)
  // History has one take per finished pass.
  await page.click('.practice button:has-text("History")')
  await page.waitForTimeout(500)
  const rows = await page.$$eval('.history table tbody tr', (els) => els.length).catch(() => 0)
  check('loop: each pass is a take in the history', rows >= 2, `${rows} rows`)
  const looping = await page.$eval('button[title="Loop"]', (e) => e.getAttribute('aria-pressed'))
  const range = await page.evaluate(() => window.__riffmaster.range())
  check('loop: the selection and Loop are kept afterwards', looping === 'true' && range?.endTick === toTick, `${looping} ${JSON.stringify(range)}`)
  check('loop: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

async function cursor() {
  // No selection: the take starts at Verse 1 (bar 9), where the position was put.
  const fromTick = 8 * 3840
  const seconds = 14
  const toTick = fromTick + seconds * TICKS_PER_SEC
  const { audio, perPass } = perform({ fromTick, toTick, passes: 1, seconds })
  const wav = `${out}take-cursor.wav`
  writeWav(wav, audio)
  const { browser, page, errors } = await open(wav)
  await page.click('.section:nth-child(3) .section-name') // jump to Verse 1
  await page.waitForTimeout(600)
  const opened = Date.now()
  await page.click('button[title="Practice"]')
  await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })
  await startInTime(page, opened)
  await page.waitForTimeout((4 * 60) / 96 * 1000 + seconds * 1000 - 1500)
  await page.click('.practice .button.primary') // Stop
  await page.waitForSelector('.practice-results', { timeout: 10000 })
  const text = (await page.textContent('.practice-results')).replace(/\s+/g, ' ')
  const hit = Number(text.match(/(\d+) of \d+ notes/)?.[1])
  const total = Number(text.match(/of (\d+) notes/)?.[1])
  const missed = Number(text.match(/(\d+) missed/)?.[1])
  console.log(`      cursor: ${text.slice(0, 160)}`)
  // Stop comes a little before the performance ends, so its last notes may fall outside the take.
  check('cursor: the take starts at the playback position', total >= perPass - 8 && total <= perPass && missed <= 1, `${hit} of ${total}, performance had ${perPass}, missed ${missed}`)
  await page.click('.practice button:has-text("History")')
  await page.waitForTimeout(500)
  const bars = await page.$eval('.history table tbody tr', (e) => e.textContent).catch(() => '')
  check('cursor: the history shows the bars from there', /\b9\b/.test(bars), bars.replace(/\s+/g, ' ').slice(0, 80))
  check('cursor: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

async function edge() {
  // Bar 10 of the first track ends with the same note it starts with, 156 ms
  // before the bar line. With Loose timing, a pass must not take the previous
  // pass's last note for its own missing first note.
  const fromTick = 9 * 3840
  const toTick = 10 * 3840
  const seconds = (3 * (toTick - fromTick)) / TICKS_PER_SEC
  const { audio, perPass } = perform({ fromTick, toTick, passes: 3, skip: { 1: [0] }, seconds, track: 0 })
  const wav = `${out}take-edge.wav`
  writeWav(wav, audio)
  const { browser, page, errors } = await open(wav, { trackRow: 1, leeway: 'loose' })
  await page.click('button[title="Loop"]')
  await page.evaluate(({ fromTick, toTick }) => {
    window.__riffmaster.api().playbackRange = { startTick: fromTick, endTick: toTick }
  }, { fromTick, toTick })
  await page.waitForTimeout(300)
  const opened = Date.now()
  await page.click('button[title="Practice"]')
  await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })
  await startInTime(page, opened)
  await page.waitForTimeout((4 * 60) / 96 * 1000 + seconds * 1000 + 1500)
  await page.click('.practice .button.primary') // Stop
  await page.waitForSelector('.practice-results', { timeout: 10000 })
  await page.waitForTimeout(800)
  const text = (await page.textContent('.practice')).replace(/\s+/g, ' ')
  const passes = (text.match(/(\d+) passes: ([\d%, ]+)/) ?? [])[2]?.split(', ').map((p) => Number(p.replace('%', ''))) ?? []
  const second = Math.round(((perPass - 1) / perPass) * 100)
  check('edge: a heard note counts for one pass only', passes[0] === 100 && passes[1] === second, `${passes.join(', ')}; pass 2 should be ${second}%`)
  check('edge: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

const which = process.argv[2] ?? 'all'
if (which === 'loop' || which === 'all') await loop()
if (which === 'cursor' || which === 'all') await cursor()
if (which === 'edge' || which === 'all') await edge()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
