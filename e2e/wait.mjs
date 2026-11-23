// Wait mode: the tab holds at each note until it is played.
// Needs the dev server on port 5173 and the sample tab. `node wait.mjs`
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'

const out = new URL('.', import.meta.url).pathname
const APP = 'http://localhost:5173/'
const SAMPLE = new URL('../samples/californication.gp', import.meta.url).pathname
const RATE = 48000
const LEAD = 7
const GAP = 0.7
const BAR = 3840
const first = 9 * BAR, end = 10 * BAR
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
async function openSong(context) {
  const page = await context.newPage()
  await page.goto(APP)
  await page.waitForSelector('.library')
  await page.setInputFiles('input[type=file]', SAMPLE)
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.click('.track:nth-child(1) .track-name')
  await page.waitForTimeout(1200)
  await page.evaluate(({ first, end }) => { window.__riffmaster.api().playbackRange = { startTick: first, endTick: end } }, { first, end })
  await page.waitForTimeout(300)
  return page
}

const reader = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const readPage = await openSong(await reader.newContext({ viewport: { width: 1280, height: 800 } }))
const beats = await readPage.evaluate(() => window.__riffmaster.expected(0, 1))
await reader.close()
console.log(`      ${beats.length} notes in the bar`)

// Played slowly and out of time: note 3 is first played wrong, and the last is never played.
const notes = []
let at = LEAD
beats.slice(0, -1).forEach((beat, i) => {
  if (i === 2) { notes.push({ timeSec: at, midi: beat.midi[0] + 5, durationSec: 0.5 }); at += GAP }
  for (const midi of beat.midi) notes.push({ timeSec: at, midi, durationSec: 0.5 })
  at += GAP
})
const lastPlayed = at
const wav = `${out}take-wait.wav`
writeWav(wav, synthesize(notes, RATE, at + 6, { noiseFloor: 0.001 }))

const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] })
const errors = []
context.on('page', (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && errors.push(m.text())) })
const page = await openSong(context)
const tick = () => page.evaluate(() => window.__riffmaster.api().tickPosition)
const opened = Date.now()
await page.click('button[title="Practice"]')
await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })
await page.click('.practice button:has-text("Wait mode")')
await page.waitForSelector('.wait-status')
await page.waitForTimeout(800)
check('it holds at the first note', Math.abs((await tick()) - beats[0].tick) < 5, String(await tick()))
check('the song is not playing', !(await page.evaluate(() => window.__riffmaster.api().playerState === 1)))
await page.waitForTimeout(Math.max(0, (LEAD - 0.5) * 1000 - (Date.now() - opened)))
check('with nothing played yet, it has not moved', Math.abs((await tick()) - beats[0].tick) < 5)
await page.waitForFunction((t) => window.__riffmaster.api().tickPosition >= t - 5, beats[2].tick, { timeout: 8000 })
await page.waitForFunction(() => /Heard/.test(document.querySelector('.wait-status')?.textContent ?? ''), null, { timeout: 5000 })
check('a wrong note is named, and it stays', Math.abs((await tick()) - beats[2].tick) < 5, (await page.textContent('.wait-status')).trim())
await page.waitForFunction((t) => window.__riffmaster.api().tickPosition >= t - 5, beats.at(-1).tick, { timeout: (lastPlayed - LEAD + 4) * 1000 })
await page.waitForTimeout(2500)
check('it waits at the last note, never played', Math.abs((await tick()) - beats.at(-1).tick) < 5, String(await tick()))
await page.click('.practice button:has-text("Skip note")')
await page.waitForSelector('.practice-results', { timeout: 3000 })
const text = (await page.textContent('.practice-results')).replace(/\s+/g, ' ')
const total = beats.length
check('the summary counts the notes', text.includes(`${total - 2} of ${total} notes first time`) && text.includes('1 after another try') && text.includes('1 skipped'), text.slice(0, 110))
check('it names the bar to look at', /bar 10\b/.test(text), text.match(/Worth[^.]*\./)?.[0] ?? '')
check('marks stay on the tab', (await page.$$('.marks .mark')).length >= total - 1, `${(await page.$$('.marks .mark')).length} marks`)
await page.click('.practice button:has-text("History")')
await page.waitForTimeout(400)
check('it adds nothing to the practice history', /No takes yet/.test(await page.textContent('.history')))
await page.click('.practice-results button:has-text("Clear results")')
await page.waitForTimeout(200)
check('clearing takes the marks off', (await page.$$('.marks .mark')).length === 0)
check('the player is free again', !(await page.$eval('.play', (e) => e.disabled)))
// Another song arriving ends a go at this one.
await page.click('.practice button:has-text("Wait mode")')
await page.waitForSelector('.wait-status')
// The same file again is opened afresh, as a new score.
await page.setInputFiles('input[type=file]', SAMPLE)
await page.waitForFunction(() => !document.querySelector('.wait-status'), null, { timeout: 15000 }).catch(() => {})
check('a song being opened ends it', (await page.$('.wait-status')) === null)
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
