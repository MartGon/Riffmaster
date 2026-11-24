// Capo and single strings: the tab is re-fretted for the player's guitar while the
// song is scored as written, the tuner and fretboard follow, editing waits, and the
// choice is kept with the song. Needs the dev server (APP_URL, default port 5173).
import { chromium } from 'playwright-core'

const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const out = new URL('.', import.meta.url).pathname
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(APP)
await page.waitForSelector('.library-empty')
await page.click('.library-buttons button:has-text("Exercises")')
await page.waitForSelector('dialog[open] select[name=exercise]')
await page.selectOption('dialog[open] select[name=exercise]', 'minor-pentatonic')
await page.click('dialog[open] button[type=submit]')
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0, null, { timeout: 30000 })
await page.waitForTimeout(600)

const capo = '.guitar-setup .tuning-picker select'
/** Every note as [string from the highest, fret], and what practice listens for. */
const tab = () =>
  page.evaluate(() => {
    const staff = window.__riffmaster.api().score.tracks[0].staves[0]
    return staff.bars.flatMap((bar) => bar.voices[0].beats.flatMap((beat) => beat.notes.map((note) => [staff.tuning.length + 1 - note.string, note.fret])))
  })
const expected = () => page.evaluate(() => window.__riffmaster.expected(0).map((n) => n.midi[0]))
const drawnFrets = () => page.$$eval('.score svg text', (list) => list.map((t) => t.textContent).filter((t) => /^-?\d+$/.test(t)).slice(0, 40).join(','))

const writtenTab = await tab()
const writtenNotes = await expected()
const writtenDrawn = await drawnFrets()
check('the pentatonic is written from fret 5', writtenTab[0][1] === 5, JSON.stringify(writtenTab.slice(0, 3)))

await page.selectOption(capo, '2')
await page.waitForTimeout(800)
const capoTab = await tab()
check('with a capo on 2, every fret is two lower', capoTab.every(([string, fret], i) => string === writtenTab[i][0] && fret === writtenTab[i][1] - 2))
check('practice listens for the same notes', JSON.stringify(await expected()) === JSON.stringify(writtenNotes))
check('the drawn tab changes too', (await drawnFrets()) !== writtenDrawn, (await drawnFrets()).slice(0, 30))
await page.click('button:has-text("Fretboard")').catch(() => {})
await page.waitForTimeout(400)
check('the fretboard shows the capo', (await page.$('.neck-capo')) !== null)

// Drop D: the low string down a tone, so its notes are two frets higher.
await page.click('.string-tuning summary')
await page.selectOption('.string-row:nth-of-type(6) select', '-2')
await page.waitForTimeout(800)
const dropTab = await tab()
check('notes on the dropped string are two frets higher', dropTab.every(([string, fret], i) => fret === capoTab[i][1] + (string === 6 ? 2 : 0)))
check('and still sound the same', JSON.stringify(await expected()) === JSON.stringify(writtenNotes))
await page.click('button:has-text("Tuner")')
await page.waitForSelector('.tuner-strings', { timeout: 5000 })
const strings = await page.$$eval('.tuner-strings li', (list) => list.map((li) => li.textContent).join(' '))
check('the tuner tunes the low string to D', strings.startsWith('D A D G B E'), strings)
await page.click('button:has-text("Tuner")')

await page.click('button:has-text("Edit")')
await page.waitForTimeout(300)
check('editing waits until the tab is as written', /as written to edit/.test(await page.textContent('body')) && !(await page.$('.editor-panel')))
await page.click('.error button[aria-label="Dismiss"]').catch(() => {})
await page.screenshot({ path: `${out}capo.png`, clip: { x: 0, y: 50, width: 260, height: 460 } })

// Kept with the song.
await page.waitForTimeout(800)
await page.click('.topbar .button')
await page.waitForSelector('.song-open')
await page.reload()
await page.waitForSelector('.song-open')
await page.click('.song-open')
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.waitForTimeout(800)
check('the capo and strings are remembered', (await page.$eval(capo, (s) => s.value)) === '2' && JSON.stringify(await tab()) === JSON.stringify(dropTab))

// A capo above the written notes moves them to other strings, at the same pitch.
await page.selectOption(capo, '7')
await page.waitForTimeout(800)
const high = await tab()
check('no fret is below the capo', high.every(([, fret]) => fret >= 0), JSON.stringify(high.slice(0, 6)))
check('moved notes still sound the same', JSON.stringify(await expected()) === JSON.stringify(writtenNotes))
check('it says notes were moved', /moved to another string/.test(await page.textContent('.guitar-setup')), (await page.textContent('.setup-note').catch(() => '')).trim())

await page.selectOption(capo, '')
await page.click('.string-rows button:has-text("Put strings back")')
await page.waitForTimeout(800)
check('back to as written', JSON.stringify(await tab()) === JSON.stringify(writtenTab) && (await drawnFrets()) === writtenDrawn)
check('the keyboard is left on the strings heading', await page.evaluate(() => document.activeElement?.matches('.string-tuning summary') ?? false))
await page.click('button:has-text("Edit")')
await page.waitForTimeout(500)
check('then it can be edited', /Editing|editor/i.test(await page.evaluate(() => document.body.className + document.querySelector('.body')?.className)))
check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
