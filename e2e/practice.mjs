// End-to-end practice check: a synthesized performance of the tab is fed to
// the browser as its microphone, and the app's score is compared with what
// was actually "played".
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { synthesize } from '../src/practice/synth.ts'

const out = new URL('.', import.meta.url).pathname
const RATE = 48000
const LEAD = 8 // seconds of silence before the performance
const TAKE = 26 // seconds of song to play
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

/** Builds the performance: every note of the tab, altered by `mistakes`. */
function perform(trackIndex, speed, mistakes, bars = null, take = TAKE) {
  // With `bars` ([first, last], counted from 0) only those bars are played, from their start.
  const inBars = (n) => !bars || (n.tick >= bars[0] * 3840 && n.tick < (bars[1] + 1) * 3840)
  const startMs = bars ? Math.min(...expectedAll[trackIndex].filter(inBars).map((n) => n.timeMs)) : 0
  const expected = expectedAll[trackIndex]
    .filter(inBars)
    .map((n) => ({ ...n, timeMs: (n.timeMs - startMs) / speed }))
    .filter((n) => n.timeMs < take * 1000)
  const single = expected.filter((n) => n.midi.length === 1)
  const chordList = expected.filter((n) => n.midi.length > 1)
  const notes = []
  expected.forEach((beat, at) => {
    const index = beat.midi.length === 1 ? single.indexOf(beat) : -1
    const chord = beat.midi.length > 1 ? chordList.indexOf(beat) : -1
    if (mistakes.skip?.includes(index) || mistakes.skipChord?.includes(chord)) return
    // A whole tone up: for a chord, a different chord altogether.
    const shift = mistakes.wrong?.includes(index) || mistakes.wrongChord?.includes(chord) ? 2 : 0
    const late = mistakes.late?.includes(index) || mistakes.lateChord?.includes(chord) ? 0.11 : 0
    // Strings ring until the next beat, as when strumming; a strum takes 10 ms per string.
    const next = expected[at + 1]?.timeMs ?? beat.timeMs + 1200
    const ring = Math.min(1.2, (next - beat.timeMs) / 1000 + 0.02)
    beat.midi.forEach((midi, string) => {
      const strum = beat.midi.length > 1 ? string * 0.01 : 0
      notes.push({ timeSec: LEAD + beat.timeMs / 1000 + late + strum, midi: midi + shift, durationSec: ring - strum })
    })
  })
  notes.sort((a, b) => a.timeSec - b.timeSec)
  // Chords are scored as well as single notes: one each. The mistakes are on single notes.
  return { audio: synthesize(notes, RATE, LEAD + take + 4, { noiseFloor: 0.001 }), scored: expected.length, chords: chordList.length }
}

async function run(label, { trackRow, trackIndex, speedClicks = 0, mistakes = {}, viewport = { width: 1280, height: 800 }, section = null }) {
  const speed = 1 - speedClicks * 0.05
  // A section: its row in the list, its bars, and how long it plays.
  const take = section ? section.seconds : TAKE
  const { audio, scored, chords } = perform(trackIndex, speed, mistakes, section?.bars, take)
  const wav = `${out}take-${label}.wav`
  writeWav(wav, audio)
  const browser = await chromium.launch({
    executablePath: '/usr/bin/brave-browser',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  })
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
  if (viewport.width <= 800) await page.click('.tracks-toggle')
  await page.click(`.track:nth-child(${trackRow}) .track-name`)
  await page.waitForTimeout(1500)
  for (let i = 0; i < speedClicks; i++) await page.click('button[aria-label="Slower"]')
  if (section) {
    // Select the section, played once rather than round and round.
    if (viewport.width <= 800) await page.click('.tracks-toggle')
    await page.click(`.section:nth-child(${section.row}) .chip`)
    await page.waitForTimeout(500)
    await page.click('button[title="Loop"]')
    if (viewport.width <= 800) await page.click('.tracks-toggle').catch(() => {})
  }

  // Opening the panel opens the microphone, which starts the audio file.
  const opened = Date.now()
  await page.click('button[title="Practice"]')
  await page.waitForSelector('.practice select')
  const micOk = await page.waitForFunction(() => !document.querySelector('.practice .button.primary')?.disabled, null, { timeout: 10000 }).then(() => true, () => false)
  check(`${label}: microphone opens`, micOk, (await page.textContent('.practice').catch(() => '')).slice(0, 120))
  if (!micOk) { await browser.close(); return }
  // One bar of count-in precedes the song; start so that the song begins a little before the performance.
  const countIn = (4 * 60) / (96 * speed)
  await page.waitForTimeout(Math.max(0, (LEAD - countIn - 0.75) * 1000 - (Date.now() - opened)))
  await page.click('.practice .button.primary')
  await page.waitForTimeout((countIn + take - 1.5) * 1000)
  const live = await page.textContent('.practice-live').catch(() => null)
  await page.screenshot({ path: `${out}practice-${label}-live.png` })
  await page.click('.practice .button.primary') // Stop
  const got = await page.waitForSelector('.practice-results', { timeout: 10000 }).then(() => true, () => false)
  if (!got) {
    check(`${label}: results appear`, false, (await page.textContent('.practice').catch(() => '')).slice(0, 200))
    await browser.close(); return
  }
  await page.waitForTimeout(1500)
  if (process.env.DEBUG_TAKE) {
    const t = await page.evaluate(() => window.__riffmasterTake)
    const lat = t.latencyMs
    const rows = t.expected.map((e) => {
      const near = t.played.filter((n) => Math.abs(n.timeMs - lat - e.timeMs) < 160).map((n) => `${Math.round(n.timeMs - lat - e.timeMs)}ms:${n.midi.join('/')}`)
      return `${(e.timeMs / 1000).toFixed(2)} want ${e.midi.join('+')} heard [${near.join(', ')}]`
    })
    console.log(rows.slice(8, 40).join('\n'))
    console.log('      anchors', t.anchors, 'latency', t.latencyMs, t.latencySource, 'played', t.played.length)
    console.log('      played  ', t.played.slice(0, 14).map((n) => `${(n.timeMs / 1000).toFixed(2)}:${n.midi.join('/')}`).join(' '))
    console.log('      expected', t.expected.slice(0, 14).map((n) => `${(n.timeMs / 1000).toFixed(2)}:${n.midi.join('+')}`).join(' '))
  }
  const text = (await page.textContent('.practice-results')).replace(/\s+/g, ' ')
  const num = (re) => Number(text.match(re)?.[1] ?? NaN)
  const r = { pct: num(/(\d+)%/), hit: num(/(\d+) of \d+ notes/), total: num(/of (\d+) notes/), onTime: num(/(\d+) on time/), early: num(/(\d+) early/), late: num(/(\d+) late/), missed: num(/(\d+) missed/), delay: num(/Delay used: (-?\d+) ms/) }
  console.log(`      ${label}: live "${live}" | ${text.slice(0, 260)}`)
  const expectMissed = ['skip', 'wrong', 'skipChord', 'wrongChord'].reduce((sum, key) => sum + (mistakes[key]?.length ?? 0), 0)
  const expectLate = (mistakes.late?.length ?? 0) + (mistakes.lateChord?.length ?? 0)
  // The take is stopped by hand, so the last note or two may fall outside it.
  check(`${label}: scores about the notes in the section`, Math.abs(r.total - scored) <= 5, `scored ${r.total}, performance had ${scored}, ${chords} of them chords`)
  check(`${label}: missed notes = skipped + wrong`, r.missed === expectMissed, `missed ${r.missed}, expected ${expectMissed}`)
  check(`${label}: late notes found`, r.late === expectLate && r.early === 0, `late ${r.late}, early ${r.early}, expected late ${expectLate}`)
  check(`${label}: the rest are on time`, r.onTime === r.total - expectMissed - expectLate, `on time ${r.onTime}`)
  check(`${label}: delay worked out from the playing`, /worked out from your playing/.test(text) && r.delay > -150 && r.delay < 800, `${r.delay} ms`)
  const coloured = await page.$$eval('.score svg [fill]', (els) => {
    const counts = {}
    for (const e of els) { const f = e.getAttribute('fill').toLowerCase(); if (/1e7b34|b35c00|c92a2a|rgb\(30|rgb\(179|rgb\(201/.test(f)) counts[f] = (counts[f] ?? 0) + 1 }
    return counts
  })
  check(`${label}: notes are coloured in the tab`, Object.keys(coloured).length > 0, JSON.stringify(coloured))
  await page.screenshot({ path: `${out}practice-${label}-results.png` })
  // The player is usable again and the marks can be cleared.
  await page.click('text=Clear results')
  await page.waitForTimeout(1500)
  const left = await page.$$eval('.score svg [fill]', (els) => els.filter((e) => /1e7b34|b35c00|c92a2a/.test(e.getAttribute('fill').toLowerCase())).length)
  check(`${label}: clearing removes the colours`, left === 0)
  check(`${label}: play button works again`, !(await page.$eval('.play', (e) => e.disabled)))
  check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300))
  await browser.close()
}

const which = process.argv[2] ?? 'all'
if (which === 'all' || which === 'clean') await run('clean', { trackRow: 5, trackIndex: 4 })
if (which === 'all' || which === 'mistakes') await run('mistakes', { trackRow: 5, trackIndex: 4, mistakes: { skip: [3, 9], wrong: [5, 12], late: [7, 15] } })
if (which === 'all' || which === 'bass') await run('bass-slow-phone', { trackRow: 6, trackIndex: 5, speedClicks: 4, mistakes: { skip: [10], wrong: [20], late: [9] }, viewport: { width: 390, height: 844 } })
// Chorus 1 (bars 37-40) of the rhythm guitar: an A minor shape strummed in sixteenths.
if (which === 'all' || which === 'chords') {
  await run('chords', {
    trackRow: 5,
    trackIndex: 4,
    section: { row: 7, bars: [36, 39], seconds: 10 },
    mistakes: { skipChord: [4], wrongChord: [10], lateChord: [12] },
  })
}
process.exit(results.every(Boolean) ? 0 : 1)
