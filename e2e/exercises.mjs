// Built-in exercises: choosing one, playing it, fingering, practice scoring.
// Needs the dev server on port 5199. `node exercises.mjs ui|practice|all`
// No tab file is needed: the app writes the exercises itself.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'
import { decodeTake } from '../src/practice/takeFile.ts'

const out = new URL('.', import.meta.url).pathname
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const flags = ['--autoplay-policy=no-user-gesture-required']

/** Opens the Exercises dialog and sets its selects by name. */
async function choose(page, values) {
  await page.click('.library-buttons button:has-text("Exercises")')
  await page.waitForSelector('dialog[open] select[name=exercise]')
  for (const [name, value] of Object.entries(values)) await page.selectOption(`dialog[open] select[name=${name}]`, value)
}
async function openExercise(page, values) {
  await choose(page, values)
  await page.click('dialog[open] button[type=submit]')
  await page.waitForSelector('.play')
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0, null, { timeout: 30000 })
  await page.waitForTimeout(600)
}
const toLibrary = async (page) => {
  await page.click('.topbar .button')
  await page.waitForSelector('.library-head')
}
/** The notes of the open tab as `string:fret` per beat, strings counted from the lowest. */
const written = (page) =>
  page.evaluate(() =>
    window.__riffmaster.api().score.tracks[0].staves[0].bars.flatMap((bar) =>
      bar.voices[0].beats.filter((beat) => beat.notes.length > 0).map((beat) => beat.notes.map((n) => `${n.string}:${n.fret}`).sort().join(' ')),
    ),
  )
const fingers = (page) => page.$$eval('.finger', (spans) => spans.map((span) => span.textContent).join(''))

async function ui() {
  const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: flags })
  const errors = []
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('http://localhost:5199/')
  await page.waitForSelector('.library-empty')
  check('an empty library offers the exercises', (await page.locator('.library-buttons button:has-text("Exercises")').count()) === 1)

  // The dialog
  await choose(page, {})
  const listed = await page.$$eval('dialog[open] select[name=exercise] optgroup', (groups) =>
    groups.map((group) => `${group.label}: ${group.querySelectorAll('option').length}`),
  )
  check('the exercises are listed in groups', listed.join(', ') === 'Scales: 5, Finger exercises: 5, Arpeggios and chords: 2', listed.join(', '))
  const scaleFields = await page.$$eval('dialog[open] .field-row select', (selects) => selects.map((s) => s.name).join(' '))
  await page.selectOption('dialog[open] select[name=exercise]', 'spider')
  const spiderFields = await page.$$eval('dialog[open] .field-row select', (selects) => selects.map((s) => s.name).join(' '))
  check('each exercise has its own choices', scaleFields === 'key position pattern' && spiderFields === 'fret order', `${scaleFields} / ${spiderFields}`)
  await page.screenshot({ path: `${out}exercises-dialog.png` })
  await page.keyboard.press('Escape')
  check('Escape closes the dialog', (await page.locator('dialog[open]').count()) === 0)

  // A scale
  await openExercise(page, { exercise: 'minor-pentatonic' })
  check('a scale opens in the player', (await page.textContent('.song-title')) === 'A minor pentatonic scale, position 1', await page.textContent('.song-title'))
  const box = await written(page)
  check('it is the first pentatonic box, up and down', box.length === 23 && box.slice(0, 12).join(' ') === '1:5 1:8 2:5 2:7 3:5 3:7 4:5 4:7 5:5 5:8 6:5 6:8' && box[22] === '1:5', box.slice(0, 12).join(' '))
  check('the tempo is the written one', (await page.textContent('.tempo-readout')).includes('80'), await page.textContent('.tempo-readout'))
  await page.click('.play')
  await page.waitForTimeout(2500)
  check('it plays', (await page.$eval('.play', (e) => e.getAttribute('aria-label'))) === 'Pause' && (await page.textContent('.seek .time')) !== '0:00')
  await page.click('.play')
  if ((await fingers(page)) === '') await page.click('button[title="Fingering"]')
  await page.waitForTimeout(500)
  check('fingers are suggested for it', (await fingers(page)).startsWith('141313131414'), (await fingers(page)).slice(0, 23))
  await page.click('button[title="Fretboard"]')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}exercises-scale.png` })
  await page.click('button[title="Fretboard"]')

  // The library keeps it, once.
  await toLibrary(page)
  const rows = () => page.$$eval('.song-row', (list) => list.map((row) => row.textContent))
  check('the exercise is kept in the library', (await rows()).length === 1 && /A minor pentatonic scale, position 1.*Exercise/.test((await rows())[0]), (await rows()).join(' | '))
  await choose(page, {})
  const again = await page.$eval('dialog[open] select[name=exercise]', (select) => select.value)
  check('the dialog comes back where it was left', again === 'minor-pentatonic', again)
  await page.click('dialog[open] button[type=submit]')
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled)
  await toLibrary(page)
  check('opening the same exercise again does not add a copy', (await rows()).length === 1, `${(await rows()).length} rows`)

  // Other choices give other tabs.
  await openExercise(page, { exercise: 'blues', key: '4', position: '0', pattern: 'fours' })
  check('key, position and pattern are followed', (await page.textContent('.song-title')) === 'E blues scale, position 1, in fours', await page.textContent('.song-title'))
  const blues = await written(page)
  check('E blues position 1 starts on the open strings', blues.slice(0, 4).join(' ') === '1:0 1:3 2:0 2:1', blues.slice(0, 8).join(' '))
  await toLibrary(page)

  // A finger exercise: the written fingers are shown.
  await openExercise(page, { exercise: 'spider', fret: '3', order: '1324' })
  const spider = await written(page)
  check('the spider follows the finger order', spider.length === 96 && spider.slice(0, 4).join(' ') === '1:3 1:5 1:4 1:6', spider.slice(0, 8).join(' '))
  const fromFile = await page.$$eval('.finger', (spans) => spans.slice(0, 8).map((s) => `${s.textContent}${s.classList.contains('finger-file') ? 'f' : ''}`).join(' '))
  check('its fingers are the written ones', fromFile === '1f 3f 2f 4f 1f 3f 2f 4f', fromFile)
  await page.screenshot({ path: `${out}exercises-spider.png` })
  await toLibrary(page)

  // Hammer-ons and pull-offs are drawn as slurs.
  await openExercise(page, { exercise: 'legato', fret: '5', fingers: '13' })
  const slurs = await page.evaluate(() => {
    const beats = window.__riffmaster.api().score.tracks[0].staves[0].bars.flatMap((bar) => bar.voices[0].beats)
    return beats.slice(0, 4).map((beat) => `${beat.notes[0].fret}${beat.notes[0].isHammerPullOrigin ? '~' : ''}`).join(' ')
  })
  check('hammer-ons and pull-offs are marked', slurs === '5~ 7 7~ 5', slurs)
  await page.screenshot({ path: `${out}exercises-legato.png` })
  await toLibrary(page)

  // Chords
  await openExercise(page, { exercise: 'chord-changes', chords: '5' })
  const chordNames = await page.evaluate(() => {
    const beats = window.__riffmaster.api().score.tracks[0].staves[0].bars.flatMap((bar) => bar.voices[0].beats)
    return beats.filter((beat) => beat.chord).map((beat) => beat.chord.name).join(' ')
  })
  const shownNames = await page.$$eval('.score svg text', (texts) => texts.map((t) => t.textContent.trim()).filter((t) => /^(C|Am|F|G)$/.test(t)).length)
  check('chord changes are written with their names', chordNames === 'C Am F G C Am F G' && shownNames >= 8, `${chordNames} · ${shownNames} names drawn`)
  await page.click('.play')
  await page.waitForTimeout(2000)
  check('chords play', (await page.textContent('.seek .time')) !== '0:00')
  await page.click('.play')
  await page.screenshot({ path: `${out}exercises-chords.png` })
  await toLibrary(page)

  // An arpeggio
  await openExercise(page, { exercise: 'arpeggio', key: '7', shape: 'major-6' })
  const arpeggio = await written(page)
  check('an arpeggio opens', arpeggio.slice(0, 7).join(' ') === '1:3 2:2 2:5 3:5 4:4 5:3 6:3', arpeggio.slice(0, 7).join(' '))
  await toLibrary(page)
  check('each exercise has its own row', (await rows()).length === 6, `${(await rows()).length} rows`)
  await page.screenshot({ path: `${out}exercises-library.png` })

  // After a reload the exercise is still found by its file name.
  await page.reload()
  await page.waitForSelector('.library-head')
  await openExercise(page, { exercise: 'spider', fret: '3', order: '1324' })
  await toLibrary(page)
  check('after a reload a known exercise is still not added twice', (await rows()).length === 6, `${(await rows()).length} rows`)
  check('no errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300))
  await context.close()

  // Phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const small = await phone.newPage()
  await small.goto('http://localhost:5199/')
  await small.waitForSelector('.library-empty')
  await small.tap('.library-buttons button:has-text("Exercises")')
  await small.waitForSelector('dialog[open] select[name=exercise]')
  const fits = await small.evaluate(() => {
    const box = document.querySelector('dialog[open]').getBoundingClientRect()
    const fields = [...document.querySelectorAll('dialog[open] select')].map((s) => s.getBoundingClientRect())
    return {
      inside: box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
      fields: fields.every((f) => f.left >= box.left && f.right <= box.right && f.width >= 80),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }
  })
  check('on a phone the dialog fits the screen', fits.inside && fits.fields && !fits.overflow, JSON.stringify(fits))
  await small.screenshot({ path: `${out}exercises-phone-dialog.png` })
  await small.tap('dialog[open] button[type=submit]')
  await small.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await small.waitForTimeout(800)
  check('on a phone the exercise opens', (await small.textContent('.song-title')) === 'A minor pentatonic scale, position 1')
  await small.screenshot({ path: `${out}exercises-phone.png` })
  await phone.close()
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

/** Practice on an exercise: a synthesized performance with two mistakes is fed in as the microphone. */
async function practice() {
  const RATE = 48000
  const LEAD = 8
  // A minor pentatonic, position 1, up and down in eighth notes at 80 bpm.
  const up = [45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72]
  const notes = [...up, ...up.slice(0, -1).reverse()]
  const skipped = 4
  const wrong = 10
  const performance = notes.flatMap((midi, index) =>
    index === skipped ? [] : [{ timeSec: LEAD + index * 0.375, midi: midi + (index === wrong ? 1 : 0), durationSec: 0.5 }],
  )
  const wav = `${out}take-exercise.wav`
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
  await page.goto('http://localhost:5199/')
  await page.waitForSelector('.library-empty')
  await openExercise(page, { exercise: 'minor-pentatonic' })
  const opened = Date.now()
  await page.click('button[title="Practice"]')
  await page.waitForSelector('.practice select')
  const micOk = await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 }).then(() => true, () => false)
  check('practice: microphone opens', micOk)
  if (!micOk) { await browser.close(); return }
  // One bar of count-in (3 s at 80 bpm) precedes the exercise.
  await page.waitForTimeout(Math.max(0, (LEAD - 3 - 0.75) * 1000 - (Date.now() - opened)))
  await page.click('.practice .button.primary')
  // The take ends by itself when the exercise does.
  const got = await page.waitForSelector('.practice-results', { timeout: 40000 }).then(() => true, () => false)
  check('practice: the take ends with the exercise and shows results', got, got ? '' : (await page.textContent('.practice').catch(() => '')).slice(0, 200))
  if (got) {
    await page.waitForTimeout(1000)
    const text = (await page.textContent('.practice-results')).replace(/\s+/g, ' ')
    const num = (re) => Number(text.match(re)?.[1] ?? NaN)
    const r = { total: num(/of (\d+) notes/), onTime: num(/(\d+) on time/), early: num(/(\d+) early/), late: num(/(\d+) late/), missed: num(/(\d+) missed/) }
    console.log(`      ${text.slice(0, 220)}`)
    if (process.env.DEBUG_TAKE) {
      const take = await page.evaluate(() => window.__riffmasterTake)
      console.log('      expected', take.expected.map((n) => `${(n.timeMs / 1000).toFixed(2)}:${n.midi.join('+')}`).join(' '))
      console.log('      played  ', take.played.map((n) => `${((n.timeMs - take.latencyMs) / 1000).toFixed(2)}:${n.midi.join('/')}`).join(' '))
    }
    check('practice: every note of the exercise is scored', r.total === 23, `scored ${r.total}`)
    check('practice: the skipped and the wrong note are missed', r.missed === 2, `missed ${r.missed}`)
    check('practice: the rest are on time', r.onTime === 21 && r.early === 0 && r.late === 0, JSON.stringify(r))
    await page.screenshot({ path: `${out}exercises-practice.png` })
    // The take can be saved as one file: the recording with the report inside.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
      page.click('.practice-results button:has-text("Save take")').catch(() => null),
    ])
    check('save: the take downloads as a WAV file', /^riffmaster-take-[\d-]+\.wav$/.test(download?.suggestedFilename() ?? ''), download?.suggestedFilename())
    if (download) {
      const file = `${out}take-saved.wav`
      await download.saveAs(file)
      const saved = decodeTake(new Uint8Array(fs.readFileSync(file)))
      const report = saved.report
      const seconds = saved.samples.length / saved.sampleRate
      check('save: the recording covers the take', seconds > 9 && seconds < 20 && Math.abs(seconds - report.savedSec) < 0.01, `${seconds.toFixed(1)} s at ${saved.sampleRate} Hz`)
      const missed = report.expected.filter((n) => n.grade === 'missed')
      check('save: the report lists every expected note with its grade', report.expected.length === 23 && missed.length === 2, `${report.expected.length} notes, ${missed.length} missed`)
      check('save: the report lists what was heard', report.heard.length >= 21 && report.heard.filter((n) => n.matched).length === 21, `${report.heard.length} heard`)
      // A matched note's place in the recording agrees with where it was heard.
      const hits = report.expected.filter((n) => n.offsetMs !== null)
      const worst = Math.max(...hits.map((n) => Math.min(...report.heard.map((h) => Math.abs(h.wavSec - (n.wavSec + n.offsetMs / 1000))))))
      check('save: expected notes are placed in the recording', worst < 0.015, `worst ${(worst * 1000).toFixed(1)} ms`)
      // And the sound is really there: loud at a played note, quiet at the skipped one.
      const level = (sec) => {
        const from = Math.round(sec * saved.sampleRate)
        let sum = 0
        for (let i = from; i < from + 4800; i++) sum += saved.samples[i] ** 2
        return Math.sqrt(sum / 4800)
      }
      const skippedNote = report.expected[skipped]
      check('save: the recording has sound at a played note', level(report.expected[0].wavSec) > 0.02, level(report.expected[0].wavSec).toFixed(4))
      check('save: the report names the input and settings', typeof report.input?.label === 'string' && report.leeway === 'normal' && report.sampleRate === saved.sampleRate, JSON.stringify(report.input).slice(0, 120))
      console.log(`      skipped note at ${skippedNote.wavSec.toFixed(2)} s, grade ${skippedNote.grade}; delay ${Math.round(report.latencyMs)} ms (${report.latencySource})`)
    }
    // The take report: note by note, what was heard against what the tab expected.
    await page.click('.practice-results button:has-text("Take report")').catch(() => null)
    const reportOpen = await page.waitForSelector('dialog.take-report[open]', { timeout: 5000 }).then(() => true, () => false)
    check('report: the take report opens', reportOpen)
    if (reportOpen) {
      const rows = await page.$$eval('dialog.take-report tbody tr', (trs) => trs.map((tr) => [...tr.cells].map((cell) => cell.textContent.trim())))
      check('report: a row per scored note', rows.length === 23, `${rows.length} rows`)
      const missedRows = rows.filter((cells) => cells.includes('Missed'))
      check('report: exactly two notes are missed', missedRows.length === 2, missedRows.map((cells) => cells[0]).join(', '))
      const rowOf = (n) => rows.find((cells) => cells[0] === String(n)) ?? []
      const wrongRow = rowOf(wrong + 1)
      const wrongHeard = wrongRow[wrongRow.length - 1] ?? ''
      check('report: the wrong note says what was heard instead', wrongRow.includes('Missed') && /^[A-G]/.test(wrongHeard) && wrongHeard !== 'nothing heard', wrongRow.join(' | '))
      const skippedRow = rowOf(skipped + 1)
      check('report: the skipped note says nothing was heard', skippedRow.includes('Missed') && skippedRow[skippedRow.length - 1] === 'nothing heard', skippedRow.join(' | '))
      console.log(`      ${(await page.textContent('dialog.take-report .take-report-lines')).replace(/\s+/g, ' ').slice(0, 240)}`)
      await page.screenshot({ path: `${out}exercises-take-report.png` })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${out}exercises-take-report-phone.png` })
      const fits = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        view: window.innerWidth,
        dialog: document.querySelector('dialog.take-report').getBoundingClientRect().right,
      }))
      check('report: on a phone the page does not scroll sideways', fits.page <= fits.view && fits.dialog <= fits.view, JSON.stringify(fits))
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.click('dialog.take-report button:has-text("Close")')
      const closed = await page.waitForSelector('dialog.take-report', { state: 'detached', timeout: 3000 }).then(() => true, () => false)
      check('report: the dialog closes', closed)
    }
    await page.click('.topbar .button')
    await page.waitForSelector('.library-head')
    const row = await page.textContent('.song-row')
    check('practice: the take is kept in the history', /1 take, \d+% learned/.test(row), row)
  }
  check('practice: no errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300))
  await browser.close()
}

const which = process.argv[2] ?? 'all'
if (which === 'all' || which === 'ui') await ui()
if (which === 'all' || which === 'practice') await practice()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
