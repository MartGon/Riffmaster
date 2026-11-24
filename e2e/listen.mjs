// Listen back: a practice take keeps its recording, lined up with the song, and can be
// played under the tab as the take, the original, or both.
// Needs the dev server (APP_URL, default port 5173). `node listen.mjs`
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'
import { decodeWav } from '../src/practice/takeFile.ts'

const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const out = new URL('.', import.meta.url).pathname
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
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

// A minor pentatonic, position 1, up and down in eighth notes at 80 bpm, played cleanly.
const RATE = 48000
const LEAD = 8
const up = [45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72]
const notes = [...up, ...up.slice(0, -1).reverse()]
const wav = `${out}take-listen.wav`
writeWav(wav, synthesize(notes.map((midi, i) => ({ timeSec: LEAD + i * 0.375, midi, durationSec: 0.5 })), RATE, LEAD + 16, { noiseFloor: 0.001 }), RATE)

const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
// Notes each recording started, and where in it.
await page.addInitScript(() => {
  const start = AudioBufferSourceNode.prototype.start
  window.__starts = []
  AudioBufferSourceNode.prototype.start = function (when, offset, ...rest) {
    if (this.buffer && this.buffer.duration > 5) window.__starts.push({ when, offset, duration: this.buffer.duration })
    return start.call(this, when, offset, ...rest)
  }
})
await page.goto(APP)
await page.waitForSelector('.library-empty')
await page.click('.library-buttons button:has-text("Exercises")')
await page.waitForSelector('dialog[open] select[name=exercise]')
await page.selectOption('dialog[open] select[name=exercise]', 'minor-pentatonic')
await page.click('dialog[open] button[type=submit]')
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.waitForTimeout(600)
const opened = Date.now()
await page.click('button[title="Practice"]')
await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })
// One bar of count-in (3 s at 80 bpm) precedes the exercise.
await page.waitForTimeout(Math.max(0, (LEAD - 3 - 0.75) * 1000 - (Date.now() - opened)))
await page.click('.practice .button.primary')
const got = await page.waitForSelector('.practice-results', { timeout: 40000 }).then(() => true, () => false)
check('a take is made', got)
await page.waitForTimeout(1500)

// What was kept.
const kept = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('riffmaster')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const read = (store) =>
    new Promise((resolve) => {
      const request = db.transaction(store).objectStore(store).getAll()
      request.onsuccess = () => resolve(request.result)
    })
  // What each recording is, and its sound, kept apart.
  const all = await read('recordings')
  const sounds = await read('recordingAudio')
  db.close()
  return all.map((r, i) => ({ ...r, wav: [...new Uint8Array(sounds[i])] }))
})
check('the take keeps one recording', kept.length === 1, `${kept.length}`)
const recording = kept[0]
const decoded = decodeWav(Uint8Array.from(recording.wav))
const seconds = decoded.samples.length / decoded.sampleRate
check('cut to the take, at 24 kHz', decoded.sampleRate === 24000 && seconds > 8 && seconds < 13, `${seconds.toFixed(2)} s`)
// The first note sounds half a second in, the delay of the microphone taken out.
// The pick of the first note is the first loud moment: the level is brought to a peak of 0.8.
const onset = decoded.samples.findIndex((sample) => Math.abs(sample) > 0.2)
const firstNoteMs = await page.evaluate(() => window.__riffmaster.expected(0)[0].timeMs)
const at = (onset / decoded.sampleRate) * 1000 + recording.songStartMs
check('the recording lines up with the song', Math.abs(at - firstNoteMs) < 60, `first note heard at song ${at.toFixed(0)} ms, written at ${firstNoteMs.toFixed(0)} ms`)

// Listening back.
await page.click('.practice button:has-text("History")')
const listenButton = await page.waitForSelector('button[aria-label^="Listen to the take"]', { timeout: 5000 }).catch(() => null)
check('the take can be listened to', listenButton !== null)
// The song's own speed is changed after the take, so the take's speed and the song's differ.
await page.focus('input[aria-label="Tempo"]')
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
await page.evaluate(() => document.activeElement?.blur())
await page.waitForTimeout(300)
const songSpeed = await page.evaluate(() => window.__riffmaster.api().playbackSpeed)
const before = await page.evaluate(() => {
  const api = window.__riffmaster.api()
  return { countIn: api.countInVolume, metronome: api.metronomeVolume, looping: api.isLooping }
})
await listenButton.click()
await page.waitForFunction(() => window.__riffmaster.api().playerState === 1, null, { timeout: 8000 }).catch(() => {})
await page.waitForFunction(() => window.__starts.length > 0, null, { timeout: 5000 }).catch(() => {})
const starts = await page.evaluate(() => window.__starts)
check('the song plays with the cursor, at the take\'s speed', await page.evaluate(() => window.__riffmaster.api().playerState === 1 && window.__riffmaster.api().playbackSpeed === 1), `song speed ${songSpeed}`)
check('the speed shown is still the song\'s own', (await page.textContent('.tempo-percent').catch(() => '')).trim() === `${Math.round(songSpeed * 100)}%`, (await page.textContent('.tempo-percent').catch(() => '')).trim())
check('and the take with it, from the right place', starts.length >= 1 && starts[0].offset >= 0 && starts[0].offset < 1.2, JSON.stringify(starts[0] ?? null))
await page.screenshot({ path: `${out}listen.png`, clip: { x: 0, y: 380, width: 1280, height: 420 } })
await page.click('.listen-mix button:has-text("Your take")')
check('"Your take" silences the song', await page.evaluate(() => window.__riffmaster.api().masterVolume === 0))
await page.click('.listen-mix button:has-text("Original")')
check('"Original" brings the song back', await page.evaluate(() => window.__riffmaster.api().masterVolume > 0))
await page.waitForTimeout(2000)
const restarts = await page.evaluate(() => window.__starts.length)
check('the take stays in line without starting over and over', restarts <= 3, `${restarts} starts`)
await page.click('.listen-bar button:has-text("Stop")')
await page.waitForTimeout(400)
const after = await page.evaluate(() => {
  const api = window.__riffmaster.api()
  return { countIn: api.countInVolume, metronome: api.metronomeVolume, looping: api.isLooping, speed: api.playbackSpeed, playing: api.playerState === 1, volume: api.masterVolume }
})
check('Stop ends it, and the player is as it was', (await page.$('.listen-bar')) === null && !after.playing && after.speed === songSpeed && after.volume > 0 && JSON.stringify({ countIn: after.countIn, metronome: after.metronome, looping: after.looping }) === JSON.stringify(before), JSON.stringify(after))

// Start pressed while listening: listening ends first, and the take runs at the song's speed.
await listenButton.click()
await page.waitForSelector('.listen-bar')
await page.waitForFunction(() => window.__riffmaster.api().playerState === 1, null, { timeout: 8000 }).catch(() => {})
await page.click('.practice .button.primary')
await page.waitForTimeout(400)
check('Start ends listening, and the take runs at the song\'s speed', (await page.$('.listen-bar')) === null && (await page.evaluate(() => window.__riffmaster.api().playbackSpeed)) === songSpeed, String(await page.evaluate(() => window.__riffmaster.api().playbackSpeed)))
await page.click('.practice button:has-text("Stop")').catch(() => {})
await page.waitForFunction(() => window.__riffmaster.api().playerState !== 1, null, { timeout: 8000 }).catch(() => {})
await page.waitForTimeout(1500)
await page.click('.practice-results button:has-text("Clear results")').catch(() => {})
if (!(await page.$('.history'))) await page.click('.practice button:has-text("History")')
await page.waitForSelector('button[aria-label^="Listen to the take"]:not([disabled])', { timeout: 5000 })

// Played to the end, it stops by itself.
await page.click('button[aria-label^="Listen to the take"]')
await page.waitForSelector('.listen-bar')
const ended = await page.waitForFunction(() => !document.querySelector('.listen-bar'), null, { timeout: 30000 }).then(() => true, () => false)
check('it ends with the take', ended)
check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
