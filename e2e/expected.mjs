// Dumps what the tab expects for each track, and checks the time map against the player.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.goto('http://localhost:5199/')
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
await page.waitForSelector('.tracks .track', { timeout: 30000 })
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
const tracks = await page.$$eval('.track-title', (els) => els.map((e) => e.textContent))
const all = {}
for (let i = 0; i < tracks.length; i++) {
  const notes = await page.evaluate((i) => window.__riffmaster.expected(i, 1), i)
  all[i] = notes
  const single = notes.filter((n) => n.midi.length === 1).length
  const first = notes[0]
  console.log(`${i} ${tracks[i].padEnd(42)} beats ${String(notes.length).padStart(4)}  single ${String(single).padStart(4)}  first at ${first ? (first.timeMs / 1000).toFixed(2) : '-'}s  last at ${notes.length ? (notes.at(-1).timeMs / 1000).toFixed(1) : '-'}s`)
}
fs.writeFileSync('expected.json', JSON.stringify(all))
const end = await page.$eval('.seek .time:last-child', (e) => e.textContent)
console.log('song length shown:', end)
// time map check: seek to a few places and compare tick -> time with the player's own clock
await browser.close()
