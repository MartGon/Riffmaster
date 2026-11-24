// Lists of songs: put songs on a list, order them, play them through one after
// another, rename and delete the list; it is kept with the songs.
// Needs the dev server (APP_URL, default port 5173).
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
page.on('dialog', (d) => d.accept())
await page.goto(APP)
await page.waitForSelector('.library-empty')

// Three exercises make three songs.
for (const exercise of ['minor-pentatonic', 'spider', 'legato']) {
  await page.click('.library-buttons button:has-text("Exercises")')
  await page.waitForSelector('dialog[open] select[name=exercise]')
  await page.selectOption('dialog[open] select[name=exercise]', exercise).catch(async () => {
    const first = await page.$eval('dialog[open] select[name=exercise] option:nth-child(2)', (o) => o.value)
    await page.selectOption('dialog[open] select[name=exercise]', first)
  })
  await page.click('dialog[open] button[type=submit]')
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.click('.topbar .button')
  await page.waitForSelector('.song-open')
}
const titles = await page.$$eval('.song-row-title', (list) => list.map((e) => e.textContent))
check('three songs in the library', titles.length === 3, titles.join(' | '))
check('no lists to begin with', (await page.$('.list-chips')) === null)

const addTo = async (title, list, create) => {
  await page.click(`button[aria-label="Lists for ${title}"]`)
  await page.waitForSelector('dialog[open]')
  if (create) {
    await page.fill('dialog[open] .new-list input', list)
    await page.click('dialog[open] .new-list button')
  } else {
    await page.check(`dialog[open] label:has-text("${list}") input`)
  }
  await page.waitForTimeout(300)
  await page.click('dialog[open] button:has-text("Done")')
}
// Added in the order 3, 1, 2.
await addTo(titles[2], 'Gig set', true)
await addTo(titles[0], 'Gig set', false)
await addTo(titles[1], 'Gig set', false)
await page.waitForSelector('.list-chips')
const chip = await page.textContent('.list-chips button:has-text("Gig set")')
check('the list appears, with its size', /Gig set\s*3/.test(chip), chip)

await page.click('.list-chips button:has-text("Gig set")')
await page.waitForTimeout(300)
const order = () => page.$$eval('.song-row-title', (list) => list.map((e) => e.textContent))
check('the list is in the order the songs were added', JSON.stringify(await order()) === JSON.stringify([titles[2], titles[0], titles[1]]), (await order()).join(' | '))
await page.click(`button[aria-label="Move ${titles[1]} up"]`)
await page.waitForTimeout(400)
check('a song moves up', JSON.stringify(await order()) === JSON.stringify([titles[2], titles[1], titles[0]]), (await order()).join(' | '))
check('the keyboard stays on the button', await page.evaluate((title) => document.activeElement?.getAttribute('aria-label') === `Move ${title} up`, titles[1]), await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName))
await page.screenshot({ path: `${out}lists.png`, clip: { x: 0, y: 50, width: 1280, height: 420 } })

// Kept with the songs.
await page.reload()
await page.waitForSelector('.list-chips')
await page.click('.list-chips button:has-text("Gig set")')
await page.waitForTimeout(300)
check('the order is kept', JSON.stringify(await order()) === JSON.stringify([titles[2], titles[1], titles[0]]))

// Play through.
await page.click('.list-head button:has-text("Play through")')
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
const place = () => page.$eval('.playlist-place', (e) => e.innerText.replace(/\s+/g, ' ').trim())
check('it opens the first song, and says where it is', (await page.textContent('.song-title')) === titles[2] && (await place()) === 'Gig set 1 of 3', await place())
check('there is no song before the first', await page.$eval('button[aria-label="Previous song in the list"]', (b) => b.disabled))
await page.click('button[aria-label="Next song in the list"]')
await page.waitForFunction((t) => document.querySelector('.song-title')?.textContent === t, titles[1], { timeout: 30000 })
check('Next opens the next song', (await place()) === 'Gig set 2 of 3', await place())
await page.click('button[aria-label="Next song in the list"]')
await page.waitForFunction((t) => document.querySelector('.song-title')?.textContent === t, titles[0], { timeout: 30000 })
check('and the last has no next', await page.$eval('button[aria-label="Next song in the list"]', (b) => b.disabled))
await page.click('.topbar .button')
await page.waitForSelector('.song-open')

// A song opened from the library is not part of a play-through.
await page.click('.list-chips button:has-text("All")')
await page.click(`.song-open:has-text("${titles[1]}")`)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
check('a song opened on its own shows no list', (await page.$('.playlist')) === null)
await page.click('.topbar .button')
await page.waitForSelector('.song-open')

// Rename and delete.
await page.click('.list-chips button:has-text("Gig set")')
await page.click('.list-head button:has-text("Rename")')
await page.fill('dialog[open] input[name=name]', 'Friday gig').catch(() => page.fill('dialog[open] input', 'Friday gig'))
await page.click('dialog[open] button[type=submit]')
await page.waitForTimeout(500)
check('the list is renamed, keeping its order', (await page.$('.list-chips button:has-text("Friday gig")')) !== null && JSON.stringify(await order()) === JSON.stringify([titles[2], titles[1], titles[0]]))
await page.click('.list-head button:has-text("Delete list")')
await page.waitForTimeout(500)
// A list with one song, taken off it and put back from the same dialog.
await page.click(`button[aria-label="Lists for ${titles[0]}"]`)
await page.waitForSelector('dialog[open]')
await page.fill('dialog[open] .new-list input', 'Solo')
await page.click('dialog[open] .new-list button')
await page.waitForTimeout(400)
const added = await page.inputValue('dialog[open] .new-list input')
await page.uncheck('dialog[open] label:has-text("Solo") input')
await page.waitForTimeout(400)
const stays = (await page.$('dialog[open] label:has-text("Solo") input')) !== null
await page.check('dialog[open] label:has-text("Solo") input')
await page.waitForTimeout(400)
await page.click('dialog[open] button:has-text("Done")')
check('an emptied list stays in the dialog, to tick again', added === '' && stays && (await page.$('.list-chips button:has-text("Solo")')) !== null, `name left "${added}", box stays ${stays}`)
check('deleting the list keeps the songs', (await page.$('.list-chips button:has-text("Friday gig")')) === null && (await order()).length === 3)
check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
