// Progress per song: how much of each song is learned, the practice streak and this
// week's minutes, worked out from the practice history. Takes are written straight
// into the library's storage. Needs the dev server (APP_URL, default port 5173).
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
await page.waitForTimeout(1000)
const noted = await page.evaluate(() => {
  const staff = window.__riffmaster.api().score.tracks[0].staves[0]
  return staff.bars.filter((bar) => bar.voices.some((v) => v.beats.some((b) => !b.isRest && b.notes.length > 0))).length
})
await page.click('.topbar .button')
await page.waitForSelector('.song-open')
check('a song not practised yet shows no progress', (await page.$('.mastery')) === null)

// Yesterday bar 1 went cleanly at full tempo; today bar 2 went half right, at full tempo.
await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('riffmaster')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const songs = await new Promise((resolve) => {
    const request = db.transaction('songs').objectStore('songs').getAll()
    request.onsuccess = () => resolve(request.result)
  })
  const songId = songs[0].id
  const now = Date.now()
  const base = { songId, trackIndex: 0, speed: 1, startBar: 0, endBar: 1, scored: 8, onTime: 8, early: 0, late: 0, missed: 0, accuracy: 1, trainer: false }
  const takes = [
    { ...base, id: 'p1', at: now - 86_400_000, bars: { 0: { scored: 8, missed: 0, offTime: 0 } }, durationMs: 4 * 60_000 },
    { ...base, id: 'p2', at: now, bars: { 1: { scored: 8, missed: 4, offTime: 0 } }, durationMs: 3 * 60_000 },
  ]
  await new Promise((resolve, reject) => {
    const tx = db.transaction('takes', 'readwrite')
    for (const take of takes) tx.objectStore('takes').put(take)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
})
await page.reload()
await page.waitForSelector('.song-open')
await page.waitForSelector('.mastery', { timeout: 5000 }).catch(() => {})
const head = (await page.textContent('.library-streak')).replace(/\s+/g, ' ')
check('the library shows the streak and the minutes', /2-day practice streak/.test(head) && /7 min this week/.test(head), head)
const meta = (await page.textContent('.song-row-meta')).replace(/\s+/g, ' ')
// Bar 1 counts fully, bar 2 half, over the bars with notes, which opening the song counted.
const expected = Math.round((1.5 / noted) * 100)
check('the song shows how much is learned', meta.includes(`2 takes, ${expected}% learned`), `${meta} (${noted} bars with notes)`)
const width = await page.$eval('.mastery span', (e) => e.style.width)
check('with a bar to match', width === `${expected}%`, width)
await page.screenshot({ path: `${out}progress-library.png`, clip: { x: 0, y: 50, width: 1280, height: 260 } })

await page.click('.song-open')
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.click('button[title="Practice"]')
await page.click('.practice button:has-text("History")')
await page.waitForSelector('.history-mastery', { timeout: 5000 }).catch(() => {})
const line = ((await page.textContent('.history-mastery').catch(() => '')) ?? '').replace(/\s+/g, ' ')
check('the history says how many bars are learned', line.includes(`${expected}% learned`) && line.includes(`1 of ${noted} bars clean at full tempo`) && line.includes('1 coming along') && line.includes(`${noted - 2} not played yet`), line)
check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
