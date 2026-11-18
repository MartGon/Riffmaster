// A phone held sideways: one long line of tab, bigger, and the controls out
// of the way while playing. Needs the dev server on port 5199. `node sideways.mjs`
import { chromium } from 'playwright-core'

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://localhost:5199/')
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
await page.click('.tracks-toggle')
await page.click('.track:nth-child(5) .track-name')
await page.waitForTimeout(2000)

const layout = await page.evaluate(() => {
  const api = window.__riffmaster.api()
  const viewport = document.querySelector('.viewport')
  return { content: document.querySelector('.score-wrap').getBoundingClientRect().height, view: viewport.clientHeight, mode: api.settings.display.layoutMode, scale: api.settings.display.scale, wide: viewport.scrollWidth > viewport.clientWidth * 3, tall: viewport.scrollHeight <= viewport.clientHeight + 60 }
})
check('sideways, the tab is one long line', layout.mode === 1 && layout.wide && layout.tall, JSON.stringify(layout))
check('sideways, the tab is drawn larger', layout.scale >= 1.4, String(layout.scale))

await page.tap('.play')
await page.waitForTimeout(1500)
const playing = await page.evaluate(() => ({
  topbar: getComputedStyle(document.querySelector('.topbar')).display,
  transport: getComputedStyle(document.querySelector('.transport')).display,
  tab: Math.round(document.querySelector('.viewport').getBoundingClientRect().height),
  pause: !!document.querySelector('.float-pause'),
}))
check('while playing, only the tab and a pause button show', playing.topbar === 'none' && playing.transport === 'none' && playing.pause && playing.tab >= 380, JSON.stringify(playing))
const centred = await page.evaluate(() => {
  const api = window.__riffmaster.api()
  const view = document.querySelector('.viewport').getBoundingClientRect()
  const score = document.querySelector('.score').getBoundingClientRect()
  // The staves count, not the tempo and markers drawn above them.
  const boxes = api.boundsLookup.staffSystems[0].bars.flatMap((bar) =>
    bar.bars.flatMap((staff) => [staff.visualBounds, ...staff.beats.flatMap((beat) => (beat.notes ?? []).map((note) => note.noteHeadBounds))]),
  )
  const top = Math.min(...boxes.map((b) => b.y))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  return { above: Math.round(score.top + top - view.top), below: Math.round(view.bottom - (score.top + bottom)) }
})
check('the staves are centred in the height', Math.abs(centred.above - centred.below) <= 4, JSON.stringify(centred))
const scroll1 = await page.$eval('.viewport', (e) => e.scrollLeft)
await page.waitForTimeout(9000)
const scroll2 = await page.$eval('.viewport', (e) => ({ left: e.scrollLeft, top: e.scrollTop }))
check('playback scrolls the tab sideways', scroll2.left > scroll1 && scroll2.top < 30, `${scroll1} → ${JSON.stringify(scroll2)}`)
await page.screenshot({ path: new URL('sideways-playing.png', import.meta.url).pathname })

const play = await page.evaluate(() => {
  const r = document.querySelector('.float-pause').getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})
await page.tap('.float-pause')
await page.waitForTimeout(800)
const paused = await page.evaluate(() => ({
  transport: getComputedStyle(document.querySelector('.transport')).display,
  pause: !!document.querySelector('.float-pause'),
  label: document.querySelector('.play')?.getAttribute('aria-label'),
}))
const playButton = await page.evaluate(() => {
  const r = document.querySelector('.play').getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})
check('the pause button sits where the play button is', Math.abs(play.x - playButton.x) <= 6 && Math.abs(play.y - playButton.y) <= 6, `${JSON.stringify(play)} vs ${JSON.stringify(playButton)}`)
check('the pause button pauses and brings the controls back', paused.transport !== 'none' && !paused.pause && paused.label === 'Play', JSON.stringify(paused))

// Sideways the tab only scrolls across, unless it is taller than the screen.
const scrollY = () => page.$eval('.viewport', (e) => ({ overflow: getComputedStyle(e).overflowY, scrollable: e.scrollHeight > e.clientHeight }))
const plain = await scrollY()
check('sideways, the tab does not scroll up and down', plain.overflow === 'hidden', JSON.stringify(plain))
await page.tap('button[title="Notation"]')
await page.waitForTimeout(2500)
// The tempo and markers above may be cut off, but the staves must fit.
const withNotation = await scrollY()
check('with notation, staves that fit still do not scroll up and down', withNotation.overflow === 'hidden', JSON.stringify(withNotation))
await page.setViewportSize({ width: 844, height: 300 })
await page.waitForTimeout(800)
const short = await scrollY()
check('staves taller than the screen can still scroll up and down', short.overflow === 'auto' && short.scrollable, JSON.stringify(short))
await page.setViewportSize({ width: 844, height: 390 })
await page.waitForTimeout(800)
await page.tap('button[title="Notation"]')
await page.waitForTimeout(2500)
check('back to tab only, up-and-down scrolling goes away again', (await scrollY()).overflow === 'hidden')

// Practice keeps its panel and controls while it plays.
await page.tap('button[title="Practice"]')
await page.waitForTimeout(500)
await page.tap('.play')
await page.waitForTimeout(1000)
check('with a panel open the controls stay', await page.$eval('.transport', (e) => getComputedStyle(e).display !== 'none'))
await page.tap('.play')

// Turned upright, the page layout comes back.
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(1500)
const upright = await page.evaluate(() => {
  const api = window.__riffmaster.api()
  return { mode: api.settings.display.layoutMode, scale: api.settings.display.scale }
})
check('turned upright, the lines run down the page again', upright.mode === 0 && upright.scale === 0.8, JSON.stringify(upright))
// Turning the phone keeps the playback position in view.
const inView = () =>
  page.evaluate(() => {
    const api = window.__riffmaster.api()
    const found = api.tickCache.findBeat(new Set([api.tracks[0].index]), api.tickPosition)
    const box = api.boundsLookup.findBeat(found.beat).visualBounds
    const viewport = document.querySelector('.viewport')
    const scoreTop = document.querySelector('.score').getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
    const x = box.x - viewport.scrollLeft
    const y = scoreTop + box.y - viewport.scrollTop
    return { x: Math.round(x), y: Math.round(y), visible: x >= 0 && x < viewport.clientWidth && y >= 0 && y < viewport.clientHeight }
  })
await page.click('.tracks-toggle')
await page.click('.section:nth-child(12) .section-name') // far into the song
await page.waitForTimeout(800)
check('upright, the position far into the song is in view', (await inView()).visible, JSON.stringify(await inView()))
await page.setViewportSize({ width: 844, height: 390 })
await page.waitForTimeout(2500)
check('turned sideways, the position is still in view', (await inView()).visible, JSON.stringify(await inView()))
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(2500)
check('turned upright again, the position is still in view', (await inView()).visible, JSON.stringify(await inView()))
check('no errors', errors.length === 0, errors.join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
