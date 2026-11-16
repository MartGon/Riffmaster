// Browser checks for the tab editor. Needs the dev server on port 5199.
// `node editor.mjs song|new|phone|all`
import { chromium } from 'playwright-core'

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const sample = new URL('../samples/californication.gp', import.meta.url).pathname

async function launch({ viewport = { width: 1280, height: 800 }, mobile = false } = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('http://localhost:5199/')
  await page.waitForSelector('.library')
  return { browser, page, errors }
}

async function openSample(page) {
  await page.setInputFiles('input[type=file]', sample)
  await page.waitForSelector('.tracks .track', { timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.waitForTimeout(800)
}

const status = (page) => page.$eval('.editor-status', (e) => e.textContent)
/** Notes of the first voice of a bar of the shown track, as "string:fret" per beat. */
const barNotes = (page, bar) =>
  page.evaluate((index) => {
    const api = window.__riffmaster.api()
    const beats = api.tracks[0].staves[0].bars[index].voices[0].beats
    return beats
      .map((beat) => (beat.isEmpty ? 'empty' : beat.notes.length ? beat.notes.map((n) => `${n.string}:${n.fret}`).join('+') : `r${beat.duration}`))
      .join(' ')
  }, bar)
const barCount = (page) => page.evaluate(() => window.__riffmaster.api().score.masterBars.length)
/** Waits until alphaTab has drawn the score again after an edit. */
async function settle(page, ms = 700) {
  await page.waitForTimeout(ms)
}
async function key(page, keys, ms = 450) {
  for (const k of keys) await page.keyboard.press(k)
  await settle(page, ms)
}

async function song() {
  const { browser, page, errors } = await launch()
  await openSample(page)
  // Rhythm guitar: a track with notes from the start.
  await page.click('.track:nth-child(5) .track-name')
  await settle(page, 1500)
  const tempoBefore = await page.$eval('input[aria-label="Tempo"]', (e) => e.value)

  await page.click('button[title="Edit"]')
  await page.waitForSelector('.editor')
  await settle(page)
  check('the editor opens with a cursor on the tab', (await page.$('.edit-layer:not([hidden]) .edit-cursor')) !== null)
  check('the status names the position', /^Bar 1, beat 1 of \d+, string 6 \(E\)/.test(await status(page)), await status(page))

  // Typing frets replaces the note on the cursor's string.
  const before = await barNotes(page, 0)
  await key(page, ['ArrowUp', 'ArrowUp', '5'])
  let notes = await barNotes(page, 0)
  check('a digit writes a fret', notes.split(' ')[0].includes('3:5'), `${before.split(' ')[0]} → ${notes.split(' ')[0]}`)
  const afterFive = notes
  await settle(page, 600)
  await key(page, ['1', '2'], 700)
  notes = await barNotes(page, 0)
  check('two quick digits write a two-digit fret', notes.split(' ')[0].includes('3:12'), notes.split(' ')[0])
  await key(page, ['Control+z'])
  notes = await barNotes(page, 0)
  check('one undo takes back both digits', notes === afterFive, `${notes.split(' ')[0]}`)
  await key(page, ['Control+z'])
  check('undo again goes back to the file', (await barNotes(page, 0)) === before)
  await key(page, ['Control+y'])
  await key(page, ['Control+y'])
  check('redo puts the fret back', (await barNotes(page, 0)).split(' ')[0].includes('3:12'))
  check('the song counts as changed', (await page.$eval('.editor-actions .button.primary', (e) => e.textContent)) === 'Save')
  const tempoAfter = await page.$eval('input[aria-label="Tempo"]', (e) => e.value)
  check('the tempo setting survives an edit', tempoAfter === tempoBefore, `${tempoBefore} → ${tempoAfter}`)

  // Speed of an edit on a long song (128 bars, 9 tracks).
  const times = []
  for (const digit of ['3', '4', '5']) {
    await settle(page, 1100)
    await page.evaluate(() => {
      const api = window.__riffmaster.api()
      const t0 = performance.now()
      window.__drawn = new Promise((resolve) => {
        const done = () => {
          api.postRenderFinished.off(done)
          resolve(performance.now() - t0)
        }
        api.postRenderFinished.on(done)
        setTimeout(() => resolve(-1), 5000)
      })
    })
    await page.keyboard.press(digit)
    times.push(Math.round(await page.evaluate(() => window.__drawn)))
  }
  check('an edit is drawn within a second on a long song', times.every((t) => t > 0 && t < 1000), times.join(', ') + ' ms')

  // A hammer-on without a following note on the string is explained, not silently dropped.
  await key(page, ['End', 'ArrowUp', 'ArrowUp', 'ArrowUp'])
  const lastBeat = await status(page)
  if (!/No note/.test(lastBeat)) await key(page, ['Delete'])
  await key(page, ['9', 'h'], 600)
  const message = await page.$eval('.editor-message', (e) => e.textContent).catch(() => '')
  check('a hammer-on with no next note says why', /following note/.test(message), message)
  await key(page, ['Control+z'])

  // Clicking a note puts the cursor on it.
  const target = await page.evaluate(() => {
    const api = window.__riffmaster.api()
    const beat = api.tracks[0].staves[0].bars[2].voices[0].beats.find((b) => b.notes.length > 0)
    const note = beat.notes[0]
    const bounds = api.boundsLookup.findBeats(beat).flatMap((b) => b.notes ?? []).find((n) => n.note === note)
    const box = bounds.noteHeadBounds
    const rect = document.querySelector('.score').getBoundingClientRect()
    return { x: rect.left + box.x + box.w / 2, y: rect.top + box.y + box.h / 2, beat: beat.index, string: note.string, fret: note.fret }
  })
  await page.mouse.click(target.x, target.y)
  await settle(page, 400)
  const clicked = await status(page)
  check('clicking a note moves the cursor to it', clicked.startsWith(`Bar 3, beat ${target.beat + 1} `) && clicked.includes(`Fret ${target.fret}`), clicked)
  const cursorAt = await page.$eval('.edit-cursor', (e) => {
    const r = e.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  check('the cursor box sits on the note', Math.abs(cursorAt.x - target.x) < 4 && Math.abs(cursorAt.y - target.y) < 4, `${Math.round(cursorAt.x - target.x)}, ${Math.round(cursorAt.y - target.y)} px off`)

  // With notation shown, the cursor stays on the tab staff.
  await page.click('button[title="Notation"]')
  await settle(page, 1500)
  const withNotation = await page.evaluate(() => {
    const api = window.__riffmaster.api()
    const beat = api.tracks[0].staves[0].bars[2].voices[0].beats.find((b) => b.notes.length > 0)
    const places = api.boundsLookup.findBeats(beat).flatMap((b) => b.notes ?? []).filter((n) => n.note === beat.notes[0])
    const rect = document.querySelector('.score').getBoundingClientRect()
    const box = places[places.length - 1].noteHeadBounds
    return { places: places.length, y: rect.top + box.y + box.h / 2 }
  })
  const cursorY = await page.$eval('.edit-cursor', (e) => {
    const r = e.getBoundingClientRect()
    return r.top + r.height / 2
  })
  check('with notation shown the cursor is on the tab staff', withNotation.places === 2 && Math.abs(cursorY - withNotation.y) < 4, `${withNotation.places} staves, ${Math.round(cursorY - withNotation.y)} px off`)
  await page.click('button[title="Notation"]')
  await settle(page, 1500)

  // Copy a bar and paste it over the next one.
  const bar3 = await barNotes(page, 2)
  await key(page, ['Control+c', 'Control+ArrowRight', 'Control+v'], 900)
  check('a copied bar pastes over the next one', (await barNotes(page, 3)) === bar3, `${(await barNotes(page, 3)).slice(0, 40)}`)

  // Insert and delete bars in every track.
  const bars = await barCount(page)
  const sectionsBefore = await page.$$eval('.section-detail', (els) => els.map((e) => e.textContent))
  await page.click('button[title="Insert an empty bar after this one"]')
  await settle(page, 900)
  check('inserting a bar adds it to the song', (await barCount(page)) === bars + 1 && (await barNotes(page, 4)) === 'empty')
  const sectionsAfter = await page.$$eval('.section-detail', (els) => els.map((e) => e.textContent))
  check('sections after the new bar move along', sectionsAfter[2] !== sectionsBefore[2], `${sectionsBefore[2]} → ${sectionsAfter[2]}`)
  await page.click('button[title="Delete this bar from every track"]')
  await settle(page, 900)
  check('deleting a bar removes it', (await barCount(page)) === bars)

  // Section and time signature dialogs.
  await page.click('button[title="Section starting at this bar"]')
  await page.fill('dialog[open] input', 'My riff')
  await page.click('dialog[open] button[type=submit]')
  await settle(page, 900)
  const sectionNames = await page.$$eval('.section-title', (els) => els.map((e) => e.textContent))
  check('a section can be named from the editor', sectionNames.includes('My riff'), sectionNames.slice(0, 4).join(', '))

  // Saving, reloading, restoring.
  await key(page, ['Control+s'], 1500)
  check('Ctrl+S saves', (await page.$eval('.editor-actions .button.primary', (e) => e.textContent)) === 'Saved')
  const savedBar = await barNotes(page, 3)
  await page.reload()
  await page.waitForSelector('.song-open')
  await page.click('.song-open')
  await page.waitForSelector('.tracks .track', { timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await settle(page, 1500)
  check('a saved edit is there after reloading', (await barNotes(page, 3)) === savedBar)
  const rememberedTrack = await page.$eval('.track.active .track-title', (e) => e.textContent).catch(() => '?')
  await page.click('button[title="Edit"]')
  await page.waitForSelector('.editor')
  await page.click('.editor-actions button:has-text("More")')
  await page.click('.menu-items button:has-text("Restore the original file")')
  await page.click('dialog[open] .button.primary')
  await settle(page, 2500)
  const restoredNames = await page.$$eval('.section-title', (els) => els.map((e) => e.textContent))
  check('restoring brings back the original file', !restoredNames.includes('My riff') && (await barNotes(page, 3)) !== savedBar, `track ${rememberedTrack}`)

  // Leaving with unsaved edits asks first.
  await key(page, ['7'], 800)
  await page.click('.topbar .button')
  await page.waitForSelector('dialog[open]')
  check('leaving with unsaved edits asks first', (await page.$eval('dialog[open] h2', (e) => e.textContent)) === 'Save your changes?')
  await page.click('dialog[open] button:has-text("Cancel")')
  check('Cancel stays in the song', (await page.$('.editor')) !== null)
  await page.click('.topbar .button')
  await page.click('dialog[open] button:has-text("Discard")')
  await page.waitForSelector('.song-open')
  check('Discard goes back to the library', (await page.$('.library')) !== null)

  // Drums cannot be edited.
  await page.click('.song-open')
  await page.waitForSelector('.tracks .track', { timeout: 30000 })
  await settle(page, 1500)
  await page.click('.track:last-child .track-name')
  await settle(page, 1500)
  await page.click('button[title="Edit"]')
  await page.waitForSelector('.editor')
  check('a drum track explains it cannot be edited', /no tablature/.test(await status(page)))

  // Playback still works after editing.
  await page.click('.track:nth-child(5) .track-name')
  await settle(page, 1500)
  await key(page, ['3'], 900)

  // A looped section stays selected through edits, and Space plays even after a click on a tool.
  await page.click('.section:nth-child(1) .chip')
  await settle(page, 800)
  await key(page, ['4'], 1500)
  const range = await page.evaluate(() => window.__riffmaster.range())
  check('a looped section stays selected after an edit', range?.startTick === 0 && range.endTick > 0, JSON.stringify(range))
  await page.click('button[title="Insert a rest before the cursor (I)"]')
  await settle(page, 900)
  await key(page, ['5'], 900)
  const beforeSpace = await barCount(page)
  await page.keyboard.press('Space')
  await page.waitForTimeout(1200)
  const playing = await page.$eval('.play', (e) => e.getAttribute('aria-label'))
  check('Space plays after a tool button was clicked', playing === 'Pause' && (await barCount(page)) === beforeSpace, playing)
  await page.keyboard.press('Space')
  await page.click('button[title="Clear selection"]')
  await page.click('.play')
  await page.waitForTimeout(1500)
  const position = await page.$eval('input[aria-label="Position"]', (e) => Number(e.value))
  check('the song plays after an edit', position > 0, `tick ${position}`)
  await page.click('.play')
  await page.screenshot({ path: new URL('editor-song.png', import.meta.url).pathname })

  check('no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

async function newTab() {
  const { browser, page, errors } = await launch()
  await page.click('button:has-text("New tab")')
  await page.fill('dialog[open] label:has-text("Title") input', 'Exercise one')
  await page.selectOption('dialog[open] label:has-text("Instrument") select', 'bass4')
  await page.fill('dialog[open] label:has-text("Beats per bar") input', '3')
  await page.fill('dialog[open] label:has-text("Bars") input', '4')
  await page.click('dialog[open] button[type=submit]')
  await page.waitForSelector('.editor', { timeout: 30000 })
  await settle(page, 1200)
  check('a new tab opens in the editor', /^Bar 1, beat 1 of 1, string 4 \(E\)/.test(await status(page)), await status(page))
  check('it has the chosen bars and strings', (await barCount(page)) === 4 && (await page.evaluate(() => window.__riffmaster.api().tracks[0].staves[0].tuning.length)) === 4)
  await key(page, ['3', 'ArrowRight', '5', 'ArrowRight', '7'], 700)
  check('notes can be typed into an empty bar', (await barNotes(page, 0)) === '1:3 1:5 1:7', await barNotes(page, 0))
  await key(page, ['ArrowRight'], 700)
  check('a full 3/4 bar moves on to the next bar', (await status(page)).startsWith('Bar 2, beat 1'), await status(page))
  for (let i = 0; i < 4; i++) await key(page, ['Control+ArrowRight'], 200)
  await key(page, ['End', 'ArrowRight'], 900)
  check('moving past the last bar adds one', (await barCount(page)) === 5, String(await barCount(page)))
  await page.click('.editor-actions button:has-text("More")')
  await page.click('.menu-items button:has-text("Song details")')
  await page.fill('dialog[open] label:has-text("Tempo") input', '90')
  await page.click('dialog[open] button[type=submit]')
  await settle(page, 900)
  check('the song tempo can be changed', (await page.$eval('.tempo-readout strong', (e) => e.textContent)) === '90')
  await page.click('.editor-actions button:has-text("More")')
  await page.click('.menu-items button:has-text("Add track")')
  await page.click('dialog[open] button[type=submit]')
  await settle(page, 1200)
  const tracks = await page.$$eval('.tracks .track', (els) => els.length)
  check('a track can be added', tracks === 2 && (await status(page)).includes('string 6'), `${tracks} tracks`)
  await page.click('.editor-actions .button.primary')
  await settle(page, 1200)
  await page.click('.topbar .button')
  await page.waitForSelector('.song-open')
  const rows = await page.$$eval('.song-row-title', (els) => els.map((e) => e.textContent))
  check('the new tab is in the library', rows.includes('Exercise one'), rows.join(', '))
  const download = page.waitForEvent('download')
  await page.click('.song-open')
  await page.waitForSelector('.tracks .track', { timeout: 30000 })
  await settle(page, 1200)
  check('the saved tab reopens with both tracks', (await page.$$eval('.tracks .track', (els) => els.length)) === 2)
  await page.click('button[title="Edit"]')
  await page.click('.editor-actions button:has-text("More")')
  await page.click('.menu-items button:has-text("Download")')
  const file = await download
  check('the tab can be downloaded as a Guitar Pro file', file.suggestedFilename() === 'Exercise one.gp', file.suggestedFilename())
  check('no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

async function phone() {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, mobile: true })
  await openSample(page)
  await page.click('.tracks-toggle')
  await page.click('.track:nth-child(5) .track-name')
  await settle(page, 1500)
  await page.click('button[title="Edit"]')
  await page.waitForSelector('.editor')
  await settle(page)
  check('phone: the number pad shows on a touch screen', (await page.$('.keypad')) !== null)
  const sizes = await page.evaluate(() => ({
    editor: document.querySelector('.editor').getBoundingClientRect().height,
    viewport: document.querySelector('.viewport').getBoundingClientRect().height,
    width: document.documentElement.scrollWidth,
  }))
  check('phone: the tab stays visible above the editor', sizes.viewport >= 200, JSON.stringify(sizes))
  check('phone: nothing is wider than the screen', sizes.width <= 390, String(sizes.width))
  await page.tap('.keypad button[aria-label="Higher string"]')
  await page.tap('.keypad button:has-text("8")')
  await settle(page, 900)
  check('phone: tapping the pad writes a fret', /Fret 8/.test(await status(page)), await status(page))
  await page.screenshot({ path: new URL('editor-phone.png', import.meta.url).pathname })
  check('phone: no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
}

const which = process.argv[2] ?? 'all'
if (which === 'song' || which === 'all') await song()
if (which === 'new' || which === 'all') await newTab()
if (which === 'phone' || which === 'all') await phone()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
