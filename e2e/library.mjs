// Library and offline checks, run against the production build (vite preview).
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5198/'
const out = new URL('.', import.meta.url).pathname
const SAMPLE = new URL('../samples/californication.gp', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
page.on('dialog', (d) => d.accept())

await page.goto(url)
await page.waitForSelector('.library-empty')
check('empty library shows the add prompt', true)
await page.screenshot({ path: `${out}lib-0-empty.png` })

await page.setInputFiles('input[type=file]', SAMPLE)
await page.waitForSelector('.tracks .track', { timeout: 30000 })
await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0, null, { timeout: 30000 })
const width = await page.$eval('.score', (e) => ({ score: e.scrollWidth, view: e.parentElement.clientWidth }))
check('adding one file opens it in the player', true, `score ${width.score}px in ${width.view}px viewport`)
check('score fits the viewport width', width.score <= width.view + 2)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })

// Change per-song settings
await page.click('.track:nth-child(5) .track-name')
await page.click('button[aria-label="Slower"]')
await page.click('button[aria-label="Slower"]')
await page.click('button[aria-label="Slower"]')
await page.click('.track:nth-child(1) .chip >> nth=0')
await page.click('button[title="Metronome"]')
const before = {
  track: await page.$eval('.track.active .track-title', (e) => e.textContent),
  bpm: await page.$eval('.tempo-readout', (e) => e.textContent),
}
await page.waitForTimeout(900)

await page.click('text=Library')
await page.waitForSelector('.songs .song-row')
const rows = await page.$$eval('.song-row-title', (els) => els.map((e) => e.textContent))
check('song is listed in the library', rows.length === 1 && rows[0] === 'Californication', rows.join(', '))
await page.screenshot({ path: `${out}lib-1-list.png` })

// Same file again must not duplicate
await page.setInputFiles('input[type=file]', SAMPLE)
await page.waitForSelector('.tracks .track', { timeout: 30000 })
await page.click('text=Library')
await page.waitForSelector('.songs .song-row')
check('adding the same file again does not duplicate it', (await page.$$('.song-row')).length === 1)

// Reload: library and settings persist
await page.reload()
await page.waitForSelector('.songs .song-row')
check('library survives a reload', (await page.$$('.song-row')).length === 1)
await page.click('.song-open')
await page.waitForSelector('.tracks .track', { timeout: 30000 })
await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0, null, { timeout: 30000 })
const after = {
  track: await page.$eval('.track.active .track-title', (e) => e.textContent),
  bpm: await page.$eval('.tempo-readout', (e) => e.textContent),
}
const muted = await page.$eval('.track:nth-child(1) .chip', (e) => e.getAttribute('aria-pressed'))
const metro = await page.$eval('button[title="Metronome"]', (e) => e.getAttribute('aria-pressed'))
check('track and tempo are remembered', after.track === before.track && after.bpm === before.bpm, `${after.track} / ${after.bpm}`)
check('mute and metronome are remembered', muted === 'true' && metro === 'true')
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.click('.play')
await page.waitForTimeout(2500)
const t = await page.$eval('.seek .time', (e) => e.textContent)
check('reopened song plays', t !== '0:00', t)
await page.click('text=Library')
await page.waitForSelector('.songs .song-row')
await page.waitForTimeout(500)
check('going back to the library stops playback', await page.evaluate(() => !document.querySelector('.transport')))

// Offline
await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 20000 })
await page.waitForTimeout(3000) // let precaching finish
await context.setOffline(true)
await page.reload()
const offlineOk = await page.waitForSelector('.songs .song-row', { timeout: 15000 }).then(() => true, () => false)
check('app loads offline with the library', offlineOk)
if (offlineOk) {
  await page.click('.song-open')
  const rendered = await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0, null, { timeout: 30000 }).then(() => true, () => false)
  check('offline: tab renders', rendered)
  const playable = await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 }).then(() => true, () => false)
  check('offline: sounds load', playable)
  if (playable) {
    await page.click('.play')
    await page.waitForTimeout(2500)
    const t2 = await page.$eval('.seek .time', (e) => e.textContent)
    check('offline: playback runs', t2 !== '0:00', t2)
  }
  await page.screenshot({ path: `${out}lib-2-offline.png` })
  await page.click('text=Library')
}
await context.setOffline(false)

// Bad file from the library screen
await page.waitForSelector('.songs .song-row')
await page.setInputFiles('input[type=file]', { name: 'broken.gp5', mimeType: 'application/octet-stream', buffer: Buffer.from('not a tab') })
await page.waitForSelector('.error', { timeout: 10000 }).catch(() => {})
const err = await page.textContent('.error').catch(() => null)
check('a bad file is reported and not added', !!err && (await page.$$('.song-row')).length === 1, err ?? 'no error')

// Delete
await page.click('button[title="Remove from library"]')
await page.waitForSelector('.library-empty', { timeout: 5000 }).catch(() => {})
check('removing a song empties the library', !!(await page.$('.library-empty')))
await page.reload()
await page.waitForSelector('.library-empty', { timeout: 10000 }).catch(() => {})
check('removal survives a reload', !!(await page.$('.library-empty')))

const real = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|import failed|unexpected error/i.test(e))
check('no console errors', real.length === 0, real.slice(0, 4).join(' | ').slice(0, 400))
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
