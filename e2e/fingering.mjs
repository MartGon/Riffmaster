// Suggested fretting-hand fingers, in the tab and on the fretboard.
// Needs the dev server on port 5199. `node fingering.mjs`
import { chromium } from 'playwright-core'

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const shot = (page, name) => page.screenshot({ path: new URL(name, import.meta.url).pathname })

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const errors = []

async function openSong(context) {
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('http://localhost:5199/')
  await page.waitForSelector('.library')
  await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
  await page.waitForSelector('.play')
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  return page
}
/** The finger numbers drawn in the tab, as `bar:string:fret` → text. */
const drawn = (page) =>
  page.$$eval('.finger', (spans) => Object.fromEntries(spans.map((span) => [span.dataset.note, span.textContent])))
const count = (page) => page.$$eval('.finger', (spans) => spans.length)

// Desktop
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await openSong(context)
  await page.click('.track:nth-child(5) .track-name') // rhythm guitar
  await page.waitForTimeout(1500)
  check('fingering is off to begin with', (await count(page)) === 0)
  await page.click('button[title="Fingering"]')
  await page.waitForTimeout(500)
  const fingers = await drawn(page)
  const total = await count(page)
  check('turning it on writes a finger beside the fretted notes', total > 1500, `${total} numbers`)
  // The opening riff: A minor shape, then F.
  const riff = [fingers['0:3:2'], fingers['0:5:1'], fingers['1:1:1'], fingers['1:2:3'], fingers['1:4:2']]
  check('the opening riff is fingered as the chords it spells', riff.join('') === '21132', JSON.stringify(riff))
  check('open strings get no number', !Object.keys(fingers).some((key) => key.endsWith(':0')))
  // Each number sits just right of its fret number.
  const placed = await page.evaluate(() => {
    const api = window.__riffmaster.api()
    const beat = api.score.tracks[4].staves[0].bars[0].voices[0].beats.find((b) => b.notes.some((n) => n.fret === 2))
    const box = api.boundsLookup.findBeats(beat).at(-1).notes.find((n) => n.note.fret === 2).noteHeadBounds
    const score = document.querySelector('.score').getBoundingClientRect()
    const span = document.querySelector('.finger[data-note="0:3:2"]').getBoundingClientRect()
    return { dx: Math.round(span.left - (score.left + box.x + box.w)), dy: Math.round(span.top - (score.top + box.y)) }
  })
  check('a number sits beside its note', placed.dx >= -2 && placed.dx <= 6 && Math.abs(placed.dy) <= 14, JSON.stringify(placed))
  await shot(page, 'fingering-desktop.png')

  // Fretboard
  await page.click('button[title="Fretboard"]')
  await page.evaluate(() => {
    const api = window.__riffmaster.api()
    api.tickPosition = api.score.masterBars[24].start
  })
  await page.waitForTimeout(800)
  const neck = await page.evaluate(() => {
    const dots = [...document.querySelectorAll('.neck-now')].map((dot) => ({ place: dot.dataset.place, finger: dot.dataset.finger ?? null }))
    const texts = [...document.querySelectorAll('.neck-now-text')].map((t) => t.textContent)
    return { dots, texts, hand: document.querySelector('.neck-hand')?.dataset.hand ?? null, label: document.querySelector('.fretboard svg').getAttribute('aria-label') }
  })
  const frettedDots = neck.dots.filter((dot) => !dot.place.endsWith(':0'))
  check('the fretboard shows fingers in its dots', frettedDots.length > 0 && frettedDots.every((dot) => /^[1-4]$/.test(dot.finger ?? '')) && neck.texts.every((t) => /^[0-4]$/.test(t)), JSON.stringify(neck))
  check('the fretboard marks where the hand is', neck.hand !== null && /finger \d/.test(neck.label), `${neck.hand} · ${neck.label}`)
  await shot(page, 'fingering-fretboard.png')

  // Another track gets its own fingering.
  await page.click('.track:nth-child(6) .track-name') // bass
  await page.waitForTimeout(1500)
  const bass = await drawn(page)
  check('another track is fingered when it is chosen', bass['0:3:7'] === '1' && bass['0:4:9'] === '3' && bass['0:3:10'] === '4', JSON.stringify([bass['0:3:7'], bass['0:4:9'], bass['0:3:10']]))

  // Close notes: a number must not run into the next fret number.
  const crowded = await page.evaluate(() => {
    const api = window.__riffmaster.api()
    const score = document.querySelector('.score').getBoundingClientRect()
    const heads = []
    for (const bar of api.tracks[0].staves[0].bars) {
      for (const beat of bar.voices[0].beats) {
        for (const place of api.boundsLookup.findBeats(beat)?.at(-1)?.notes ?? []) heads.push(place.noteHeadBounds)
      }
    }
    let overlaps = 0
    for (const span of document.querySelectorAll('.finger')) {
      const r = span.getBoundingClientRect()
      const x = r.left - score.left
      const y = r.top - score.top
      // Overlapping a fret number other than its own, by more than a sliver.
      if (heads.some((h) => x + r.width > h.x + 1.5 && x < h.x + h.w - 1.5 && y + r.height > h.y + 3 && y < h.y + h.h - 3)) overlaps++
    }
    return { overlaps, moved: document.querySelectorAll('.finger[data-placed]').length }
  })
  check('numbers do not run into neighbouring fret numbers', crowded.overlaps === 0 && crowded.moved > 0, JSON.stringify(crowded))
  await shot(page, 'fingering-bass.png')

  // Notation on: numbers stay on the tab staff, one per note.
  const bassTotal = await count(page)
  await page.click('button[title="Notation"]')
  await page.waitForTimeout(2500)
  check('with notation shown each note still has one number', (await count(page)) === bassTotal, `${await count(page)} vs ${bassTotal}`)
  await shot(page, 'fingering-notation.png')
  await page.click('button[title="Notation"]')
  await page.waitForTimeout(2000)

  // Editing changes the suggestion.
  await page.click('button[title="Edit"]')
  await page.waitForTimeout(800)
  const before = JSON.stringify(await drawn(page))
  await page.keyboard.press('9')
  await page.waitForTimeout(1200)
  const edited = await drawn(page)
  check('a note typed in the editor gets a finger', JSON.stringify(edited) !== before && Object.keys(edited).some((key) => /^0:\d:9$/.test(key)), Object.keys(edited).filter((key) => key.startsWith('0:')).join(' '))
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(1200)
  check('undo puts the fingering back', JSON.stringify(await drawn(page)) === before)
  await page.click('button[title="Edit"]')

  // Off again, and remembered.
  await page.click('button[title="Fingering"]')
  await page.waitForTimeout(300)
  check('turning it off takes the numbers away', (await count(page)) === 0)
  await page.click('button[title="Fingering"]')
  await page.waitForTimeout(300)
  const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('riffmaster.prefs')).showFingering)
  check('the choice is remembered on this device', remembered === true)

  // Drums have nothing to finger.
  const drums = await page.evaluate(() => window.__riffmaster.api().score.tracks.findIndex((t) => t.staves[0].isPercussion))
  if (drums >= 0) {
    await page.click(`.track:nth-child(${drums + 1}) .track-name`)
    await page.waitForTimeout(1500)
    check('a drum track shows no numbers', (await count(page)) === 0)
  }
  await context.close()
}

// Phone
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await openSong(context)
  await page.click('.tracks-toggle')
  await page.click('.track:nth-child(5) .track-name')
  await page.waitForTimeout(1500)
  await page.tap('button[title="Fingering"]')
  await page.waitForTimeout(500)
  const fits = await page.evaluate(() => {
    const row = document.querySelector('.transport-row:last-child')
    const buttons = [...row.querySelectorAll('.toggle')].map((b) => b.getBoundingClientRect())
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      inside: buttons.every((b) => b.left >= 0 && b.right <= window.innerWidth),
      smallest: Math.round(Math.min(...buttons.map((b) => b.width))),
      rows: new Set(buttons.map((b) => Math.round(b.top))).size,
    }
  })
  check('on a phone the buttons still fit on one line', !fits.overflow && fits.inside && fits.smallest >= 24 && fits.rows === 1, JSON.stringify(fits))
  check('on a phone the numbers are drawn', (await count(page)) > 1500)
  await page.tap('button[title="Fretboard"]')
  await page.waitForTimeout(500)
  await shot(page, 'fingering-phone.png')
  // Sideways
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(2500)
  check('sideways the numbers follow the single line', (await count(page)) > 1500)
  const bar = await page.$eval('.transport', (e) => Math.round(e.getBoundingClientRect().height))
  check('sideways the controls still share one line', bar <= 48, `${bar}px`)
  await shot(page, 'fingering-sideways.png')
  await context.close()
}

// A very narrow phone
{
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true })
  const page = await openSong(context)
  const rows = await page.$$eval('.transport-row:last-child .toggle', (buttons) => new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size)
  check('at 320 px wide the buttons are on one line', rows === 1, `${rows} lines`)
  await context.close()
}

check('no errors', errors.length === 0, errors.join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
