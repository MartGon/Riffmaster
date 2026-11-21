// The Tuning list: a song shifted by semitones sounds shifted, is practised
// shifted, the tuner and fretboard follow, and the choice is kept with the song.
// Needs the dev server (APP_URL, default port 5173). No tab file is needed.
// `node tuning.mjs ui|practice|all`
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'

const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const out = new URL('.', import.meta.url).pathname
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const flags = ['--autoplay-policy=no-user-gesture-required']

/** Feeds everything sent to the speakers into an analyser; `__pitchClass()` names the loudest pitch class. */
const tap = () => {
  const connect = AudioNode.prototype.connect
  const taps = new WeakMap()
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode) {
      let analyser = taps.get(target.context)
      if (!analyser) {
        analyser = target.context.createAnalyser()
        analyser.fftSize = 16384
        analyser.smoothingTimeConstant = 0
        taps.set(target.context, analyser)
        ;(window.__analysers ??= []).push(analyser)
      }
      connect.call(this, analyser)
    }
    return connect.call(this, target, ...rest)
  }
  window.__pitchClass = () => {
    const analyser = window.__analysers?.at(-1)
    if (!analyser) return null
    const data = new Float32Array(analyser.frequencyBinCount)
    analyser.getFloatFrequencyData(data)
    const hzPerBin = analyser.context.sampleRate / analyser.fftSize
    let best = -1
    for (let i = Math.floor(80 / hzPerBin); i < 1500 / hzPerBin; i++) if (best < 0 || data[i] > data[best]) best = i
    if (best < 0 || data[best] < -70) return null
    const midi = 69 + 12 * Math.log2((best * hzPerBin) / 440)
    return ((Math.round(midi) % 12) + 12) % 12
  }
}

async function openExercise(page, exercise) {
  await page.click('.library-buttons button:has-text("Exercises")')
  await page.waitForSelector('dialog[open] select[name=exercise]')
  await page.selectOption('dialog[open] select[name=exercise]', exercise)
  await page.click('dialog[open] button[type=submit]')
  await page.waitForSelector('.play')
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0, null, { timeout: 30000 })
  await page.waitForTimeout(600)
}

/** Plays from the start for a few seconds and counts the pitch classes heard. */
async function listen(page, ms = 4000) {
  await page.evaluate(() => window.__riffmaster.api().stop())
  await page.click('.play')
  const heard = new Array(12).fill(0)
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const pc = await page.evaluate(() => window.__pitchClass())
    if (pc !== null) heard[pc]++
    await page.waitForTimeout(60)
  }
  await page.click('.play')
  return heard
}

// A minor pentatonic is A C D E G. Two semitones up it is B D E F♯ A:
// C and G are heard only as written, F♯ and B only when shifted.
const asWritten = (heard) => heard[0] + heard[7]
const shiftedUp2 = (heard) => heard[6] + heard[11]

async function ui() {
  const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: flags })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.addInitScript(tap)
  await page.goto(APP)
  await page.waitForSelector('.library-empty')
  await openExercise(page, 'minor-pentatonic')

  const options = await page.$$eval('.tuning-picker option', (list) => list.map((o) => [o.value, o.textContent]))
  const label = (value) => options.find(([v]) => v === value)?.[1]
  check('the Tuning list names each choice after the tuning it needs', label('0') === 'E standard (as written)' && label('-1') === 'E♭ standard (−1 semitone)' && label('2') === 'F♯ standard (+2 semitones)', `${label('-1')} / ${label('0')} / ${label('2')}`)

  // From the start of the song; the player reports the position a moment after a stop.
  const expectedMidi = async () => {
    await page.evaluate(() => window.__riffmaster.api().stop())
    await page.waitForFunction(() => window.__riffmaster.api().tickPosition < 50)
    return page.evaluate(() => window.__riffmaster.expected(0).slice(0, 3).map((n) => n.midi[0]))
  }
  const before = await expectedMidi()
  const plain = await listen(page)
  check('as written, the scale sounds as written', asWritten(plain) > 3 * shiftedUp2(plain), JSON.stringify(plain))

  await page.selectOption('.tuning-picker select', '2')
  const after = await expectedMidi()
  check('practice expects the notes two semitones up', after.every((midi, i) => midi === before[i] + 2), `${before} → ${after}`)
  const shifted = await listen(page)
  check('shifted, the scale sounds two semitones up', shiftedUp2(shifted) > 3 * asWritten(shifted), JSON.stringify(shifted))

  const written = await page.evaluate(() => window.__riffmaster.api().score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret)
  check('the tab is unchanged', written === 5, `first fret ${written}`)

  await page.click('button[title="Tuner"]').catch(() => page.click('button:has-text("Tuner")'))
  const strings = await page.waitForSelector('.tuner-strings', { timeout: 5000 }).then(() => page.$$eval('.tuner-strings li', (list) => list.map((li) => li.textContent).join(' ')), () => '')
  check('the tuner tunes to the shifted tuning', strings === 'F♯ B E A C♯ F♯', strings)

  // Kept with the song.
  await page.waitForTimeout(800)
  await page.click('.topbar .button')
  await page.waitForSelector('.song-open')
  await page.reload()
  await page.waitForSelector('.song-open')
  await page.click('.song-open')
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.waitForTimeout(800)
  const kept = await page.$eval('.tuning-picker select', (s) => s.value)
  check('the tuning is remembered with the song', kept === '2', kept)
  const again = await listen(page)
  check('reopened, it still sounds shifted', shiftedUp2(again) > 3 * asWritten(again), JSON.stringify(again))

  await page.selectOption('.tuning-picker select', '0')
  const back = await listen(page)
  check('back to as written, it sounds as written', asWritten(back) > 3 * shiftedUp2(back), JSON.stringify(back))
  await page.screenshot({ path: `${out}tuning.png`, clip: { x: 0, y: 50, width: 260, height: 300 } })
  check('ui: no errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

function writeWav(path, samples, rate) {
  const data = Buffer.alloc(44 + samples.length * 2)
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  fs.writeFileSync(path, data)
}

/** A take on the exercise shifted two semitones up: played shifted it scores, one note played as written is missed. */
async function practice() {
  const RATE = 48000
  const LEAD = 8
  const up = [45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72]
  const notes = [...up, ...up.slice(0, -1).reverse()]
  const asTabbed = 10
  const performance = notes.map((midi, index) => ({ timeSec: LEAD + index * 0.375, midi: midi + (index === asTabbed ? 0 : 2), durationSec: 0.5 }))
  const wav = `${out}take-tuning.wav`
  writeWav(wav, synthesize(performance, RATE, LEAD + 16, { noiseFloor: 0.001 }), RATE)
  const browser = await chromium.launch({
    executablePath: '/usr/bin/brave-browser',
    headless: true,
    args: [...flags, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(APP)
  await page.waitForSelector('.library-empty')
  await openExercise(page, 'minor-pentatonic')
  await page.selectOption('.tuning-picker select', '2')
  const opened = Date.now()
  await page.click('button[title="Practice"]')
  await page.waitForSelector('.practice select')
  const micOk = await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 }).then(() => true, () => false)
  check('practice: microphone opens', micOk)
  if (!micOk) { await browser.close(); return }
  // One bar of count-in (3 s at 80 bpm) precedes the exercise.
  await page.waitForTimeout(Math.max(0, (LEAD - 3 - 0.75) * 1000 - (Date.now() - opened)))
  check('practice: the Tuning list can be changed before a take', await page.$eval('.tuning-picker select', (s) => s.disabled).catch(() => false) === false)
  await page.click('.practice .button.primary')
  await page.waitForTimeout(300)
  const locked = await page.$eval('.tuning-picker select', (s) => s.disabled)
  const got = await page.waitForSelector('.practice-results', { timeout: 40000 }).then(() => true, () => false)
  check('practice: the take ends and shows results', got)
  if (got) {
    await page.waitForTimeout(1000)
    const text = (await page.textContent('.practice-results')).replace(/\s+/g, ' ')
    const num = (re) => Number(text.match(re)?.[1] ?? NaN)
    const r = { total: num(/of (\d+) notes/), onTime: num(/(\d+) on time/), missed: num(/(\d+) missed/) }
    check('practice: notes played two semitones up are scored, the one played as tabbed is missed', r.total === 23 && r.missed === 1 && r.onTime === 22, JSON.stringify(r))
  }
  check('practice: the Tuning list was locked during the take', locked)
  check('practice: no errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

const which = process.argv[2] ?? 'all'
if (which === 'all' || which === 'ui') await ui()
if (which === 'all' || which === 'practice') await practice()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
