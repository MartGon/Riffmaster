// Find the note: a whole game against a synthesized guitar through a fake microphone.
// Needs the dev server on port 5173. `node findnote.mjs`
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'
import { buildTargets, DEFAULT_SETTINGS } from '../src/exercises/findNote.ts'

const out = new URL('.', import.meta.url).pathname
const APP = 'http://localhost:5173/'
const RATE = 48000
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
const seededSource = `(() => { let seed = 7; return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 } })()`
const targets = buildTargets({ ...DEFAULT_SETTINGS }, eval(seededSource))

// Answers come well after each prompt. Note 3 is first played a tone wrong; the last is never played.
const FIRST = 5.5, GAP = 2
const notes = []
let at = FIRST
targets.slice(0, -1).forEach((target, i) => {
  if (i === 2) { notes.push({ timeSec: at, midi: target.midi + 2, durationSec: 0.35 }); at += 0.7 }
  notes.push({ timeSec: at, midi: target.midi, durationSec: 0.5 })
  at += GAP
})
const wav = `${out}take-findnote.wav`
writeWav(wav, synthesize(notes, RATE, at + 14, { noiseFloor: 0.001 }))

const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
})
const context = await browser.newContext({ viewport: { width: 390, height: 780 }, permissions: ['microphone'] })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(APP)
await page.waitForSelector('.library')
await page.click('button:has-text("Find the note")')
await page.waitForSelector('.find-note form')
check('the dialog fits a phone', await page.$eval('.find-note', (e) => e.scrollWidth <= e.clientWidth + 1))
await page.screenshot({ path: `${out}findnote-setup.png` })
// The notes are drawn when Start is pressed, so the same random numbers give the notes above.
await page.evaluate((source) => { Math.random = eval(source) }, seededSource)
await page.click('.find-note button:has-text("Start")')
await page.waitForSelector('.find-note-count', { timeout: 8000 })
check('it counts in', true)
await page.waitForSelector('.find-note-name', { timeout: 6000 })
const first = await page.textContent('.find-note-string')
check('it names a string', /string/.test(first), first)
await page.screenshot({ path: `${out}findnote-game.png` })
await page.waitForFunction(() => /Note 2 of/.test(document.querySelector('.find-note-top')?.textContent ?? ''), null, { timeout: 9000 })
check('a right note moves on', true)
await page.waitForFunction(() => /Heard/.test(document.querySelector('.find-note-status')?.textContent ?? ''), null, { timeout: 12000 })
check('a wrong note is named', true, (await page.textContent('.find-note-status')).trim())
await page.waitForSelector('.find-note-results', { timeout: 45000 })
const text = (await page.textContent('.find-note-results')).replace(/\s+/g, ' ')
await page.screenshot({ path: `${out}findnote-results.png` })
check('nine of ten found, the last ran out of time', text.includes('9 of 10'), text.slice(0, 120))
check('first-try share counts the wrong note', text.includes('80%'), text.match(/First try\d+%/)?.[0] ?? '')
check('a first score is a new best', text.includes('New best'))
check('it lists the note to look at again', /Worth another look/.test(text))
const scored = Number(text.match(/([\d,]+) points/)?.[1].replace(/,/g, ''))
check('the score is plausible', scored > 500 && scored < 1800, String(scored))
await page.click('.find-note button:has-text("Change settings")')
await page.waitForSelector('.find-note form')
check('the best score is kept', (await page.textContent('.find-note-meta')).includes(scored.toLocaleString('en-US')), (await page.textContent('.find-note-meta')).trim())
await page.reload()
await page.waitForSelector('.library')
await page.click('button:has-text("Find the note")')
await page.waitForSelector('.find-note form')
check('and survives a reload', (await page.textContent('.find-note-meta')).includes(scored.toLocaleString('en-US')))
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check('Escape closes it', (await page.$('.find-note')) === null)
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
