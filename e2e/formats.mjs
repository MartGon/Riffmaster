// Every file format the app accepts, opened in the app: Guitar Pro 3 to 8, MusicXML
// (plain and compressed) and Capella. The files are alphaTab's own test files
// (MPL-2.0), downloaded once into e2e/formats/. Needs the dev server on port 5199.
// `node formats.mjs [url]`
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5199/'
const dir = new URL('formats/', import.meta.url).pathname
const SOURCE = 'https://raw.githubusercontent.com/CoderLine/alphaTab/develop/packages/alphatab/test-data/'
const FILES = [
  'guitarpro3/effects.gp3',
  'guitarpro4/fade-to-black.gp4',
  'conversion/full-song.gp5',
  'conversion/full-song.gpx',
  'guitarpro6/chords.gpx',
  'guitarpro7/serenade.gp',
  'guitarpro7/drum-tabs.gp',
  'guitarpro8/directions.gp',
  'musicxml-samples/Binchois.xml',
  'musicxml-samples/DebuMandSample.mxl',
  'musicxml3/chord-diagram.musicxml',
  'capella/twinkle-mozart.capx',
]

fs.mkdirSync(dir, { recursive: true })
for (const file of FILES) {
  const target = dir + file.replace('/', '-')
  if (fs.existsSync(target)) continue
  const response = await fetch(SOURCE + file)
  if (!response.ok) throw new Error(`Could not download ${file}: ${response.status}`)
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()))
}

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
let errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url)
await page.waitForSelector('.library')
const accept = await page.$eval('input[type=file]', (e) => e.accept)
check('the picker offers every format', ['.gp3', '.gp4', '.gp5', '.gpx', '.gp', '.xml', '.musicxml', '.mxl', '.capx'].every((ext) => accept.split(',').includes(ext)), accept)

for (const file of FILES) {
  const name = file.replace('/', '-')
  errors = []
  try {
    await page.evaluate(() => {
      window.__previousScore = window.__riffmaster?.api()?.score ?? null
    })
    await page.setInputFiles('input[type=file]', dir + name)
    // Wait for this file's score, not the one shown before it.
    await page.waitForFunction(() => {
      const score = window.__riffmaster?.api()?.score
      return score && score !== window.__previousScore && document.querySelectorAll('.score svg').length > 0
    }, null, { timeout: 30000 })
    await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
    const info = await page.evaluate(() => {
      const api = window.__riffmaster.api()
      return { tracks: api.score.tracks.length, listed: document.querySelectorAll('.tracks .track').length, bars: api.score.masterBars.length }
    })
    // Play a moment from the start.
    // The first playback of a page takes a moment to start its audio.
    await page.click('.play')
    await page.waitForFunction(() => document.querySelector('.seek .time')?.textContent !== '0:00', null, { timeout: 6000 }).catch(() => {})
    const time = await page.$eval('.seek .time', (e) => e.textContent)
    await page.click('.play')
    // The panels that read the notes of the track.
    for (const panel of ['Fingering', 'Fretboard', 'Practice']) {
      const button = await page.$(`button[title="${panel}"]`)
      if (button) {
        await button.click()
        await page.waitForTimeout(400)
        await button.click()
      }
    }
    // A track without strings is drawn in notation, and the Notation button says so.
    const notation = await page.$eval('button[title="Notation"]', (e) => ({ pressed: e.getAttribute('aria-pressed'), disabled: e.disabled }))
    const tabless = await page.evaluate(() => !window.__riffmaster.api().tracks[0].staves.some((s) => s.isStringed && !s.isPercussion))
    const shown = info.tracks === info.listed && (!tabless || (notation.pressed === 'true' && notation.disabled))
    check(`${name}: opens, plays and shows its tracks`, shown && time !== '0:00' && errors.length === 0,
      `${info.tracks} tracks, ${info.bars} bars${tabless ? ', notation only' : ''}, played to ${time}${errors.length ? `, errors: ${errors.slice(0, 2).join(' | ').slice(0, 200)}` : ''}`)
  } catch (error) {
    check(`${name}: opens, plays and shows its tracks`, false, String(error).split('\n')[0])
  }
  await page.click('button:has-text("Library")').catch(() => {})
  await page.waitForSelector('.library', { timeout: 10000 }).catch(() => {})
}

await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
