// Browser checks for sections, the fretboard, the tuner, live practice marks,
// practice history and the speed trainer.
// Run `node expected.mjs` first. `node features.mjs ui|tuner|trainer|all`
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'

const out = new URL('.', import.meta.url).pathname
const RATE = 48000
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

async function openApp({ wav = null, viewport = { width: 1280, height: 800 } } = {}) {
  const args = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}%noloop`)
  const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args })
  const context = await browser.newContext({ viewport, permissions: ['microphone'] })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('http://localhost:5199/')
  await page.waitForSelector('.library')
  await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
  await page.waitForSelector('.tracks .track', { timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  return { browser, page, errors }
}

const position = (page) => page.$eval('input[aria-label="Position"]', (e) => Number(e.value))

async function ui(label, viewport) {
  const { browser, page, errors } = await openApp({ viewport })
  const phone = viewport.width <= 800
  const openSidebar = async () => { if (phone) await page.click('.tracks-toggle') }
  await openSidebar()
  await page.click('.track:nth-child(5) .track-name') // rhythm guitar
  await page.waitForTimeout(1500)
  await openSidebar()
  const names = await page.$$eval('.section-title', (els) => els.map((e) => e.textContent))
  check(`${label}: sections are listed`, names.length === 18 && names[0] === 'Intro' && names.includes('Guitar Solo'), `${names.length}: ${names.slice(0, 4).join(', ')}…`)
  const detail = await page.$eval('.section:nth-child(3) .section-detail', (e) => e.textContent)
  check(`${label}: a section shows its bars`, detail === 'Bars 9–14', detail)

  await page.click('.section:nth-child(3) .section-name') // Verse 1, bar 9
  await page.waitForTimeout(600)
  const tick = await position(page)
  check(`${label}: clicking a section jumps to it`, Math.abs(tick - 8 * 3840) <= 1, `tick ${tick}`)
  await openSidebar()
  const current = await page.$$eval('.section.active .section-title', (els) => els.map((e) => e.textContent))
  check(`${label}: the section being played is highlighted`, current.join() === 'Verse 1', current.join())

  await page.click('.section:nth-child(7) .chip') // Chorus 1, bars 37-40
  await page.waitForTimeout(800)
  const range = await page.evaluate(() => window.__riffmaster.range())
  const looping = await page.$eval('button[title="Loop"]', (e) => e.getAttribute('aria-pressed'))
  check(`${label}: looping a section selects its bars`, range && range.startTick === 36 * 3840 && range.endTick > 39.9 * 3840 && range.endTick <= 40 * 3840 && looping === 'true', JSON.stringify(range) + ` loop ${looping}`)
  check(`${label}: the selection can be cleared`, (await page.$('button[title="Clear selection"]')) !== null)

  // Fretboard
  await page.click('button[title="Fretboard"]')
  await page.waitForSelector('.fretboard svg')
  const neck = await page.$eval('.fretboard svg', (e) => ({ width: e.getBoundingClientRect().width, strings: e.querySelectorAll('.neck-string').length, frets: e.querySelectorAll('.neck-fret').length }))
  check(`${label}: the fretboard has the track's strings`, neck.strings === 6 && neck.frets >= 12, JSON.stringify(neck))
  check(`${label}: the fretboard fits the screen`, neck.width <= viewport.width, `${Math.round(neck.width)} of ${viewport.width}`)
  await page.click('.play')
  let seen = 0
  let seenNext = 0
  const labels = new Set()
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(250)
    const now = await page.$$eval('.neck-now', (els) => els.length)
    seen = Math.max(seen, now)
    seenNext = Math.max(seenNext, await page.$$eval('.neck-next', (els) => els.length))
    labels.add(await page.$eval('.fretboard svg', (e) => e.getAttribute('aria-label')))
  }
  await page.screenshot({ path: `${out}features-${label}-fretboard.png` })
  await page.click('.play')
  check(`${label}: the fretboard shows the notes being played`, seen > 0 && labels.size > 2, `${seen} dots, ${labels.size} different positions`)
  check(`${label}: the fretboard shows the next notes`, seenNext > 0)
  // The dots must agree with the tab: compare with the beat alphaTab reports.
  await page.waitForTimeout(400)
  const agree = await page.evaluate(() => {
    const want = window.__riffmaster.beatNow()
    const shown = [...document.querySelectorAll('.neck-now')].map((e) => e.dataset.place).sort()
    return { ok: want !== null && want.length > 0 && want.join() === shown.join(), detail: `tab ${want?.join(' ')} | shown ${shown.join(' ')}` }
  })
  check(`${label}: dots match the tab's strings and frets`, agree.ok, agree.detail)

  await openSidebar()
  await page.click('.track:nth-child(6) .track-name') // bass
  await page.waitForTimeout(1500)
  const bass = await page.$$eval('.fretboard .neck-string', (els) => els.length)
  check(`${label}: a bass track gets four strings`, bass === 4, String(bass))
  const kept = await page.evaluate(() => ({ range: window.__riffmaster.range(), drawn: [...document.querySelectorAll('.at-selection div')].filter((e) => e.getBoundingClientRect().width > 0).length }))
  check(`${label}: the selection carries over to another track`, kept.range?.startTick === 36 * 3840 && kept.drawn > 0, JSON.stringify(kept))
  await openSidebar()
  await page.click('.track:nth-child(9) .track-name') // drums
  await page.waitForTimeout(1500)
  const drums = await page.textContent('.fretboard')
  check(`${label}: drums have no fretboard`, /no fretboard/.test(drums), drums.slice(0, 60))
  // While paused the fretboard follows the position.
  await openSidebar()
  await page.click('.track:nth-child(5) .track-name')
  await page.waitForTimeout(1500)
  await openSidebar()
  await page.click('.section:nth-child(3) .section-name')
  await page.waitForTimeout(700)
  const paused = await page.evaluate(() => {
    const want = window.__riffmaster.beatNow()
    const shown = [...document.querySelectorAll('.neck-now')].map((e) => e.dataset.place).sort()
    return { ok: want !== null && want.length > 0 && want.join() === shown.join(), detail: `tab ${want?.join(' ')} | shown ${shown.join(' ')}` }
  })
  check(`${label}: the fretboard follows the position while paused`, paused.ok, paused.detail)
  if (phone) check(`${label}: the closed track list cannot be tabbed into`, await page.$eval('.sidebar', (e) => e.inert))

  if (phone) {
    // With every panel open the tab must still be visible.
    await page.click('button[title="Practice"]')
    await page.waitForSelector('.practice select')
    await page.check('text=Speed trainer')
    await page.click('.practice button:has-text("History")')
    await page.waitForTimeout(500)
    const room = await page.evaluate(() => ({ tab: Math.round(document.querySelector('.viewport').getBoundingClientRect().height), transportBottom: Math.round(document.querySelector('.transport').getBoundingClientRect().bottom), page: window.innerHeight }))
    await page.screenshot({ path: `${out}features-phone-all-open.png` })
    check(`${label}: the tab stays visible with every panel open`, room.tab >= 100 && room.transportBottom <= room.page, JSON.stringify(room))
    await page.uncheck('text=Speed trainer')
    await page.click('button[title="Practice"]')
  }

  // A selection does not outlive the song it was made in.
  await page.click(phone ? 'header .button' : 'text=Library')
  await page.waitForSelector('.song-row')
  await page.click('.song-open')
  await page.waitForSelector('.tracks .track', { timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.waitForTimeout(800)
  const stale = await page.evaluate(() => window.__riffmaster.range())
  check(`${label}: the selection is dropped when the song is reopened`, stale === null && (await page.$('button[title="Clear selection"]')) === null, JSON.stringify(stale))
  await page.click('button[title="Notation"]')
  await page.waitForTimeout(1500)
  await page.click('button[title="Notation"]')
  await page.waitForTimeout(1000)

  await page.reload()
  await page.waitForSelector('.library')
  await page.click('.song-open')
  await page.waitForSelector('.tracks .track', { timeout: 30000 })
  check(`${label}: the fretboard choice is remembered`, await page.waitForSelector('.fretboard', { timeout: 5000 }).then(() => true, () => false))
  check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300))
  await browser.close()
}

async function tuner() {
  // Six seconds of a flat low E, then six of an A that is in tune, then a note far from any string.
  const notes = []
  for (let t = 0; t < 6; t += 1.5) notes.push({ timeSec: 6 + t, midi: 40 - 0.18, durationSec: 1.45 })
  for (let t = 0; t < 6; t += 1.5) notes.push({ timeSec: 13 + t, midi: 45.02, durationSec: 1.45 })
  for (let t = 0; t < 4.5; t += 1.5) notes.push({ timeSec: 20 + t, midi: 73.3, durationSec: 1.45 })
  const wav = `${out}tuner.wav`
  writeWav(wav, synthesize(notes, RATE, 27, { noiseFloor: 0.001 }))
  const { browser, page, errors } = await openApp({ wav })
  await page.click('button[title="Practice"]')
  await page.waitForSelector('.practice select')
  await page.click('button[title="Tuner"]')
  const opened = Date.now()
  await page.waitForSelector('.tuner')
  check('tuner: opening it closes practice', (await page.$('.practice:not(.tuner) select')) === null)
  const read = async () => page.evaluate(() => ({
    note: document.querySelector('.tuner-note strong')?.textContent,
    cents: document.querySelector('.tuner-note span')?.textContent,
    advice: document.querySelector('.tuner-advice')?.textContent,
    string: document.querySelector('.tuner-strings .active')?.textContent ?? null,
  }))
  const at = async (sec) => { await page.waitForTimeout(Math.max(0, sec * 1000 - (Date.now() - opened))); return read() }
  const quiet = await at(3)
  check('tuner: asks for a string while it is quiet', quiet.note === '–' && /Play one open string/.test(quiet.advice), JSON.stringify(quiet))
  const flat = await at(10)
  await page.screenshot({ path: `${out}features-tuner-flat.png` })
  check('tuner: reads a flat low E', flat.note === 'E2' && Math.abs(parseInt(flat.cents) + 18) <= 4 && /tune up/.test(flat.advice) && flat.string === 'E', JSON.stringify(flat))
  const good = await at(17)
  check('tuner: reads an A that is in tune', good.note === 'A2' && Math.abs(parseInt(good.cents)) <= 4 && good.advice === 'In tune' && good.string === 'A', JSON.stringify(good))
  const far = await at(23.5)
  check('tuner: names a note that is no open string', far.note === 'C♯5' && far.string === null && Math.abs(parseInt(far.cents) - 30) <= 5, JSON.stringify(far))
  const silent = await at(28.5)
  check('tuner: clears when the sound stops', silent.note === '–', JSON.stringify(silent))
  await page.click('button[title="Tuner"]')
  check('tuner: closes', (await page.$('.tuner')) === null)
  check('tuner: no console errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300))
  await browser.close()
}

async function trainer() {
  const LEAD = 9
  const speed = 0.8
  const expected = JSON.parse(fs.readFileSync(`${out}expected.json`))[4]
    .filter((n) => n.tick < 4 * 3840 - 60) // the intro: bars 1 to 4
    .map((n) => ({ ...n, timeMs: n.timeMs / speed }))
  const single = expected.filter((n) => n.midi.length === 1)
  const notes = []
  // One note of bar 2 is left out and another is played late: still a pass, and a bar to work on.
  const inBar2 = single.filter((n) => n.tick >= 3840 && n.tick < 7680)
  const skipped = inBar2[1]
  const late = inBar2[2]
  for (const beat of expected) {
    if (beat === skipped) continue
    for (const midi of beat.midi) notes.push({ timeSec: LEAD + beat.timeMs / 1000 + (beat === late ? 0.11 : 0), midi, durationSec: 1.2 })
  }
  const sectionSec = (4 * 4 * 60) / (96 * speed)
  const wav = `${out}trainer.wav`
  writeWav(wav, synthesize(notes, RATE, LEAD + sectionSec + 40, { noiseFloor: 0.001 }))
  const { browser, page, errors } = await openApp({ wav })
  await page.click('.track:nth-child(5) .track-name')
  await page.waitForTimeout(1500)
  for (let i = 0; i < 4; i++) await page.click('button[aria-label="Slower"]')
  await page.click('.section:nth-child(1) .chip') // loop the intro
  await page.waitForTimeout(500)
  const opened = Date.now()
  await page.click('button[title="Practice"]')
  await page.waitForSelector('.practice select')
  await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 })
  await page.check('text=Speed trainer')
  const hint = await page.textContent('.practice')
  check('trainer: explains what it will do', /repeats the selected bars from 80% tempo/.test(hint), hint.slice(-160))
  await page.click('.practice button:has-text("History")')
  check('history: empty at first', /No takes yet/.test(await page.textContent('.history')))
  const countIn = (4 * 60) / (96 * speed)
  await page.waitForTimeout(Math.max(0, (LEAD - countIn - 0.75) * 1000 - (Date.now() - opened)))
  await page.click('.practice .button.primary')
  check('trainer: the button stops the trainer', /Stop trainer/.test(await page.textContent('.practice .button.primary')))
  check('trainer: other controls are locked', await page.$eval('.play', (e) => e.disabled) && await page.$eval('.section:nth-child(2) .section-name', (e) => e.disabled))
  await page.waitForTimeout((countIn + sectionSec - 2) * 1000)
  const liveMarks = await page.$$eval('.marks .mark', (els) => els.map((e) => e.className))
  await page.screenshot({ path: `${out}features-trainer-live.png` })
  check('practice: notes are marked while playing', liveMarks.length >= single.length * 0.5 && liveMarks.filter((c) => /mark-onTime/.test(c)).length >= liveMarks.length - 2 && liveMarks.some((c) => /mark-missed/.test(c)) && liveMarks.some((c) => /mark-late/.test(c)), `${liveMarks.length} marks for ${single.length} notes: ${[...new Set(liveMarks)].join(' ')}`)
  // The round ends by itself when the section has been played.
  const got = await page.waitForSelector('.practice-results', { timeout: 15000 }).then(() => true, () => false)
  check('trainer: the round ends at the end of the section', got)
  await page.waitForTimeout(700)
  const text = (await page.textContent('.practice')).replace(/\s+/g, ' ')
  await page.screenshot({ path: `${out}features-trainer-round1.png` })
  check('trainer: a clean round passes', /Round 1 passed\. Next round at 85% tempo/.test(text), text.match(/Round[^.]*\.[^.]*\./)?.[0] ?? text.slice(0, 200))
  check('practice: the score counts the section', new RegExp(`${single.length - 1} of ${single.length} notes`).test(text) && /1 late/.test(text) && /1 missed/.test(text), text.match(/\d+ of \d+ notes/)?.[0])
  const tempo = await page.textContent('.tempo-percent')
  check('trainer: the tempo is raised', tempo === '85%', tempo)
  // Marks sit beside their notes: each within a few pixels of a fret number.
  const placed = await page.evaluate(() => {
    const numbers = [...document.querySelectorAll('.score svg text')].map((e) => e.getBoundingClientRect())
    const marks = [...document.querySelectorAll('.marks .mark')].map((e) => e.getBoundingClientRect())
    let worst = 0
    for (const mark of marks) {
      const x = mark.left + mark.width / 2
      const y = mark.top + mark.height / 2
      let nearest = Infinity
      for (const box of numbers) nearest = Math.min(nearest, Math.hypot(x - box.right, y - box.top))
      worst = Math.max(worst, nearest)
    }
    return { ok: marks.length > 0 && worst < 12, detail: `${marks.length} marks, furthest ${Math.round(worst)}px from a number's corner` }
  })
  check('practice: marks sit beside their notes', placed.ok, placed.detail)
  // Clicking the tab between rounds must not change what the trainer plays.
  const before = await page.evaluate(() => window.__riffmaster.range())
  const box = await page.$eval('.score', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + 320 } })
  await page.mouse.click(box.x, box.y)
  await page.waitForTimeout(200)
  const afterClick = await page.evaluate(() => window.__riffmaster.range())
  check('trainer: a click on the tab between rounds changes nothing', JSON.stringify(before) === JSON.stringify(afterClick) && before !== null, JSON.stringify(afterClick))
  // With notation shown, a note is marked on both staves.
  const history = (await page.textContent('.history')).replace(/\s+/g, ' ')
  check('history: the take is recorded', /1 take · best 94% at 80% tempo/.test(history) && /1–4/.test(history), history.slice(0, 200))
  check('history: the chart is drawn', (await page.$$('.trend .trend-point')).length === 1)
  // Round two starts by itself.
  const second = await page.waitForFunction(() => /\d+ \/ \d+ notes/.test(document.querySelector('.practice-live')?.textContent ?? ''), null, { timeout: 15000 }).then(() => true, () => false)
  check('trainer: the next round starts by itself', second)
  const speedNow = await page.evaluate(() => window.__riffmaster.speed())
  check('trainer: the next round plays at the new tempo', Math.abs(speedNow - 0.85) < 1e-6, String(speedNow))
  await page.click('.practice .button.primary') // Stop trainer
  await page.waitForTimeout(2500)
  const after = await page.textContent('.practice .button.primary')
  check('trainer: stopping ends it', /Start practice/.test(after) && !(await page.$eval('.play', (e) => e.disabled)), after)
  await page.waitForTimeout(3500)
  check('trainer: no further round starts', /Start practice/.test(await page.textContent('.practice .button.primary')))

  // Without playing, a round fails and the tempo stays.
  await page.click('.practice .button.primary')
  const failed = await page.waitForFunction(() => /below the 90% target/.test(document.querySelector('.trainer-status')?.textContent ?? ''), null, { timeout: 40000 }).then(() => true, () => false)
  check('trainer: a failed round keeps the tempo', failed && (await page.textContent('.tempo-percent')) === '85%', await page.textContent('.trainer-status').catch(() => ''))
  await page.click('.practice .button.primary') // stop between rounds
  await page.waitForTimeout(4000)
  check('trainer: stopping between rounds works', /Start practice/.test(await page.textContent('.practice .button.primary')) && (await page.$('.practice-live')) === null)
  // The failed round's results are showing. With notation on, each note is marked on both staves.
  const tabOnly = (await page.$$('.marks .mark')).length
  await page.click('button[title="Notation"]')
  await page.waitForTimeout(2000)
  const both = (await page.$$('.marks .mark')).length
  await page.screenshot({ path: `${out}features-marks-notation.png` })
  await page.click('button[title="Notation"]')
  await page.waitForTimeout(2000)
  const back = (await page.$$('.marks .mark')).length
  check('practice: with notation shown, notes are marked on both staves', tabOnly === single.length && both === 2 * tabOnly && back === tabOnly, `${tabOnly} → ${both} → ${back}`)
  const historyAfter = (await page.textContent('.history')).replace(/\s+/g, ' ')
  await page.screenshot({ path: `${out}features-history.png` })
  check('history: a round in which nothing was played is not kept', /1 take ·/.test(historyAfter), historyAfter.slice(0, 160))
  check('history: the bar that went wrong is offered', /Bar 2/.test(historyAfter) && !/Bar [134]/.test(historyAfter), historyAfter.match(/Bars to work on.*/)?.[0].slice(0, 120))
  await page.click('.history-bars button')
  await page.waitForTimeout(600)
  const range = await page.evaluate(() => window.__riffmaster.range())
  check('history: a bar can be looped from there', range && range.startTick === 3840 && range.endTick <= 7680 && range.endTick > 7500, JSON.stringify(range))

  await page.click('text=Library')
  await page.waitForSelector('.song-row')
  const row = await page.textContent('.song-row-meta')
  check('history: the library shows practice per song', /1 practice take, best 94%/.test(row), row)
  await page.click('.song-open')
  await page.waitForSelector('.tracks .track', { timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.click('button[title="Practice"]')
  await page.click('.practice button:has-text("History")')
  check('history: it is still there after reopening the song', /1 take ·/.test(await page.textContent('.history')))
  page.once('dialog', (d) => d.accept())
  await page.click('text=Clear history')
  await page.waitForTimeout(500)
  check('history: it can be cleared', /No takes yet/.test(await page.textContent('.history')))
  check('trainer: no console errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300))
  await browser.close()
}

const which = process.argv[2] ?? 'all'
if (which === 'all' || which === 'ui') await ui('desktop', { width: 1280, height: 800 })
if (which === 'all' || which === 'ui') await ui('phone', { width: 390, height: 844 })
if (which === 'all' || which === 'tuner') await tuner()
if (which === 'all' || which === 'trainer') await trainer()
process.exit(results.every(Boolean) ? 0 : 1)
