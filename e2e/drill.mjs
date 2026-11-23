// Riff to exercise: a drill made from the bars of a plan step opens as its own
// exercise, in the guitar's tuning, plays, can be practised, and is not added twice.
// Needs the dev server (APP_URL, default port 5173) and samples/californication.gp.
import { chromium } from 'playwright-core'

const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const SAMPLE = new URL('../samples/californication.gp', import.meta.url).pathname
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}
const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const playerReady = () => page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
const idb = (run, arg) => page.evaluate(run, arg)
const songs = () =>
  idb(() => new Promise((resolve) => {
    const open = indexedDB.open('riffmaster')
    open.onsuccess = () => {
      const get = open.result.transaction('songs').objectStore('songs').getAll()
      get.onsuccess = () => { open.result.close(); resolve(get.result.filter((s) => s.deletedAt === null)) }
    }
  }))

await page.goto(APP)
await page.waitForSelector('.library-empty')
await page.setInputFiles('input[type=file]', SAMPLE)
await page.waitForSelector('.play')
await playerReady()
const track = await page.evaluate(() => window.__riffmaster.api().tracks[0].index)
const written = await page.evaluate((index) => {
  const staff = window.__riffmaster.api().score.tracks[index].staves[0]
  return [84, 85].map((bar) => staff.bars[bar].voices[0].beats.flatMap((b) => b.notes.map((n) => n.realValue)))
}, track)
await page.selectOption('.tuning-picker select', '-1')
await page.waitForTimeout(700)
await page.click('.topbar .button')
await page.waitForSelector('.plan')
const id = (await songs())[0].id
await idb(([songId, trackIndex]) => new Promise((resolve) => {
  const open = indexedDB.open('riffmaster')
  open.onsuccess = () => {
    const tx = open.result.transaction('takes', 'readwrite')
    tx.objectStore('takes').put({
      id: 'd1', songId, at: Date.now() - 86_400_000, trackIndex, speed: 1, startBar: 84, endBar: 85,
      scored: 16, onTime: 8, early: 0, late: 0, missed: 8, accuracy: 0.5,
      bars: { 84: { scored: 8, missed: 4, offTime: 0 }, 85: { scored: 8, missed: 4, offTime: 0 } }, trainer: false,
    })
    tx.oncomplete = () => { open.result.close(); resolve() }
  }
}), [id, track])
await page.reload()
await page.waitForSelector('.plan-step:has(.plan-kind.focus)')
await page.click('.plan-step:has(.plan-kind.focus) button')
await page.waitForSelector('.practice')
await playerReady()
await page.waitForFunction(() => window.__riffmaster.api().playbackRange !== null, null, { timeout: 30000 })

await page.click('.practice button:has-text("Make drill")')
await page.waitForSelector('dialog[open] .drill-choices')
check('the dialog names the selected bars', (await page.textContent('dialog[open] h2')).includes('bars 85–86'), await page.textContent('dialog[open] h2'))
const boxes = await page.$$eval('dialog[open] input[type=checkbox]', (list) => list.map((b) => [b.name, b.checked, b.disabled]))
check('slow and chunks are on by default', boxes.find(([n]) => n === 'slow')[1] && boxes.find(([n]) => n === 'chunks')[1], JSON.stringify(boxes))
if (!boxes.find(([n]) => n === 'strings')[2]) await page.check('dialog[open] input[name=strings]')
await page.screenshot({ path: new URL('drill-dialog.png', import.meta.url).pathname })
await page.click('dialog[open] button[type=submit]')
await page.waitForFunction(() => /Exercise/.test(document.querySelector('.song-artist')?.textContent ?? ''), null, { timeout: 30000 })
await playerReady()
await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0)
await page.waitForTimeout(800)

const drill = await page.evaluate(() => {
  const score = window.__riffmaster.api().score
  return {
    title: score.title,
    tracks: score.tracks.length,
    sections: score.masterBars.filter((b) => b.section).map((b) => b.section.text),
    slow: [0, 1].map((bar) => score.tracks[0].staves[0].bars[bar].voices[0].beats.flatMap((b) => b.notes.map((n) => n.realValue))),
    bars: score.masterBars.length,
  }
})
check('the drill opens as its own exercise', drill.title.endsWith('bars 85–86 drill') && drill.tracks === 1, drill.title)
check('it has named parts, ending at full tempo', drill.sections[0].startsWith('Slow') && drill.sections.some((s) => s.startsWith('Chunks')) && drill.sections.at(-1) === 'Full tempo', drill.sections.join(', '))
check('its slow part has the notes of the passage', JSON.stringify(drill.slow) === JSON.stringify(written), `${drill.slow[0].length} + ${drill.slow[1].length} notes`)
check('the parts are listed in the sidebar', (await page.$$('.sidebar .section-row, .sidebar [class*=section] button')).length > 0)
check('it keeps the tuning the guitar is in', (await page.$eval('.tuning-picker select', (s) => s.value)) === '-1', await page.$eval('.tuning-picker select', (s) => s.value))
const expected = await page.evaluate(() => window.__riffmaster.expected(0).length)
check('practice mode has notes to score in it', expected > 0, `${expected} notes`)

const before = await page.evaluate(() => window.__riffmaster.api().tickPosition)
await page.click('.play')
await page.waitForFunction((tick) => window.__riffmaster.api().tickPosition > tick + 200, before, { timeout: 15000 }).then(() => check('it plays', true), () => check('it plays', false))
await page.click('.play')

const count = (await songs()).length
await page.click('.topbar .button')
await page.waitForSelector('.plan')
const kinds = await page.$$eval('.plan-kind', (list) => list.map((k) => k.textContent))
check('a drill does not become a step of the plan by itself', kinds.filter((k) => k === 'Focus').length === 1, kinds.join(', '))
await page.click('.plan-step:has(.plan-kind.focus) button')
await page.waitForSelector('.practice')
await playerReady()
await page.waitForFunction(() => window.__riffmaster.api().playbackRange !== null, null, { timeout: 30000 })
await page.click('.practice button:has-text("Make drill")')
await page.waitForSelector('dialog[open] .drill-choices')
if (!boxes.find(([n]) => n === 'strings')[2]) await page.check('dialog[open] input[name=strings]')
await page.click('dialog[open] button[type=submit]')
await page.waitForFunction(() => /Exercise/.test(document.querySelector('.song-artist')?.textContent ?? ''), null, { timeout: 30000 })
await page.waitForTimeout(500)
check('the same drill is opened again, not added twice', (await songs()).length === count, `${count} → ${(await songs()).length}`)

const real = errors.filter((e) => !/favicon|404/.test(e))
check('no errors', real.length === 0, real.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
