// Today's practice plan: built from the history, opens each step ready to
// practise, ticks steps off from today's takes, skips, and stays put after a reload.
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

/** Writes takes straight into the library. */
const seed = (takes) =>
  page.evaluate(
    (list) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('riffmaster')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('takes', 'readwrite')
          for (const take of list) tx.objectStore('takes').put(take)
          tx.oncomplete = () => { open.result.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
      }),
    takes,
  )
const songId = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('riffmaster')
        open.onsuccess = () => {
          const get = open.result.transaction('songs').objectStore('songs').getAll()
          get.onsuccess = () => { open.result.close(); resolve(get.result.find((s) => s.artist !== 'Exercise').id) }
        }
      }),
  )
const take = (id, song, at, track, bars, speed = 1) => ({
  id, songId: song, at, trackIndex: track, speed,
  startBar: Math.min(...Object.keys(bars).map(Number)), endBar: Math.max(...Object.keys(bars).map(Number)),
  scored: 16, onTime: 8, early: 0, late: 0, missed: 8, accuracy: 0.5,
  bars: Object.fromEntries(Object.entries(bars).map(([bar, missed]) => [bar, { scored: 8, missed, offTime: 0 }])),
  trainer: false,
})
const toLibrary = async () => {
  await page.click('.topbar .button')
  await page.waitForSelector('.plan')
}
const playerReady = () => page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
const loopState = () =>
  page.evaluate(() => {
    const api = window.__riffmaster.api()
    const cache = api.tickCache
    const range = api.playbackRange
    const bar = (tick) => cache.masterBars.find((b) => tick >= b.start && tick < b.end)?.masterBar.index
    return { looping: api.isLooping, first: range && bar(range.startTick), last: range && bar(range.endTick - 1), speed: api.playbackSpeed, track: api.tracks[0].index }
  })

await page.goto(APP)
await page.waitForSelector('.library-empty')
await page.setInputFiles('input[type=file]', SAMPLE)
await page.waitForSelector('.play')
await playerReady()
const shownTrack = await page.evaluate(() => window.__riffmaster.api().tracks[0].index)
await page.waitForTimeout(600)
await toLibrary()
check('a song never practised is offered as new', (await page.textContent('.plan-steps')).includes('Not practised yet'))

const id = await songId()
const yesterday = Date.now() - 86_400_000
await seed([take('a1', id, yesterday, shownTrack, { 8: 5, 9: 4, 20: 1 }, 0.9)])
await page.reload()
await page.waitForSelector('.plan-step')
const kinds = await page.$$eval('.plan-kind', (list) => list.map((k) => k.textContent))
check('the plan starts with a warm-up, then the weak bars', kinds[0] === 'Warm-up' && kinds[1] === 'Focus', kinds.join(', '))
const text = await page.textContent('.plan-steps')
check('the focus step names its bars and tempo', text.includes('Bars 9–10') && text.includes('80% tempo'), text.slice(0, 120))
const total = await page.$$eval('.plan-time', (list) => list.reduce((sum, t) => sum + parseInt(t.textContent), 0))
check('the steps fit the time chosen', total <= 20, `${total} min`)

await page.selectOption('.plan-minutes select', '10')
await page.waitForFunction(() => [...document.querySelectorAll('.plan-time')].reduce((sum, t) => sum + parseInt(t.textContent), 0) <= 10)
check('a shorter session gets a shorter plan', true)
await page.selectOption('.plan-minutes select', '20')

await page.click('.plan-step:has(.plan-kind.focus) button')
await page.waitForSelector('.plan-bar')
await playerReady()
await page.waitForFunction(() => window.__riffmaster.api().playbackRange !== null, null, { timeout: 30000 })
await page.waitForSelector('.practice')
let loop = await loopState()
check('a step opens its bars on a loop at its tempo', loop.looping && loop.first === 8 && loop.last === 9 && loop.speed === 0.8, JSON.stringify(loop))
check('the step shows its time left', /\d:\d\d/.test(await page.textContent('.plan-clock')))
check('the practice panel is open for it', (await page.$('.practice')) !== null)

await seed([take('a2', id, Date.now(), shownTrack, { 8: 0, 9: 0 }, 0.8)])
await page.reload()
await page.waitForSelector('.plan-step.done')
const doneText = await page.textContent('.plan-step.done')
check('a take covering the bars ticks the step off', doneText.includes('Bars 9–10') && doneText.includes('Done today'), doneText)
const samePlan = (await page.$$eval('.plan-kind', (list) => list.map((k) => k.textContent))).join()
check('the plan stays the same after that take', samePlan === kinds.join(), samePlan)

await page.click('.plan .button.primary')
await page.waitForSelector('.plan-bar')
await page.waitForFunction(() => document.querySelector('.plan-bar')?.textContent.includes('Warm-up'))
await playerReady()
await page.waitForFunction(() => /Exercise/.test(document.querySelector('.song-artist')?.textContent ?? ''), null, { timeout: 30000 })
check('Continue opens the next step, adding the warm-up exercise', true)
await page.click('.plan-bar .toggle')
await page.waitForFunction(() => !document.querySelector('.plan-bar')?.textContent.includes('Warm-up'), null, { timeout: 20000 })
await playerReady()
await page.waitForTimeout(600)
const after = await page.$('.plan-bar')
check('Skip moves on to the next step', after !== null, after ? await after.textContent() : 'plan finished')
if (after) await page.click('.plan-bar .icon-button')
check('leaving the plan takes its bar away', (await page.$('.plan-bar')) === null)
await toLibrary()
check('a skipped step is shown as skipped', (await page.textContent('.plan-steps')).includes('Skipped today'))
await page.reload()
await page.waitForSelector('.plan-step')
check('skipping is remembered', (await page.textContent('.plan-steps')).includes('Skipped today'))
const exerciseRows = await page.$$eval('.song-row-meta', (list) => list.filter((m) => m.textContent.startsWith('Exercise')).length)
check('the warm-up is in the library once', exerciseRows === 1, String(exerciseRows))

await page.setViewportSize({ width: 390, height: 780 })
await page.waitForTimeout(200)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
check('the plan fits a phone', !overflow)
await page.screenshot({ path: new URL('plan-phone.png', import.meta.url).pathname })
const real = errors.filter((e) => !/favicon|404/.test(e))
check('no errors', real.length === 0, real.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
