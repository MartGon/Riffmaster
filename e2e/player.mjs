import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5199/'
const out = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({
  executablePath: '/usr/bin/brave-browser',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

async function run(label, viewport, colorScheme) {
  const context = await browser.newContext({ viewport, colorScheme })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(url)
  await page.screenshot({ path: `${out}${label}-0-empty.png` })

  await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
  await page.waitForSelector('.tracks .track', { timeout: 20000 })
  const title = await page.textContent('.song-title')
  const artist = await page.textContent('.song-artist').catch(() => '')
  const tracks = await page.$$eval('.track-title', (els) => els.map((e) => e.textContent))
  console.log('      default track: ' + (await page.$eval('.track.active .track-title', (e) => e.textContent)))
  check(`${label}: score loads`, tracks.length > 0, `${title} / ${artist} / tracks: ${tracks.join(', ')}`)

  await page.waitForFunction(() => document.querySelectorAll('.score svg').length > 0, null, { timeout: 30000 })
  const svgs = await page.$$eval('.score svg', (els) => els.length)
  check(`${label}: tab is rendered`, svgs > 0, `${svgs} svg chunks`)

  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  check(`${label}: sounds loaded, play enabled`, true)
  await page.screenshot({ path: `${out}${label}-1-loaded.png` })

  const time = () => page.$eval('.seek .time', (e) => e.textContent)
  const bpm = () => page.$eval('.tempo-readout', (e) => e.textContent)
  const baseBpm = await bpm()

  // Play
  await page.click('.play')
  await page.waitForTimeout(3500)
  const t1 = await time()
  const playing = await page.$eval('.play', (e) => e.getAttribute('aria-label'))
  const cursor = await page.$eval('.at-cursor-beat', (e) => {
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }
  }).catch(() => null)
  check(`${label}: playback advances`, playing === 'Pause' && t1 !== '0:00', `time ${t1}, cursor ${JSON.stringify(cursor)}`)
  await page.screenshot({ path: `${out}${label}-2-playing.png` })

  // Tempo change while playing
  await page.click('button[aria-label="Slower"]')
  await page.click('button[aria-label="Slower"]')
  const slowBpm = await bpm()
  await page.waitForTimeout(1500)
  const t2 = await time()
  check(`${label}: tempo changes while playing`, slowBpm !== baseBpm && (await page.$eval('.play', (e) => e.getAttribute('aria-label'))) === 'Pause', `${baseBpm} -> ${slowBpm}, time ${t2}`)

  // Speed actually affects the rate: measure ticks over 2s at 50% vs 100%
  const rate = async () => {
    const a = await page.$eval('.seek input', (e) => Number(e.value))
    await page.waitForTimeout(2000)
    const b = await page.$eval('.seek input', (e) => Number(e.value))
    return b - a
  }
  await page.$eval('.tempo input', (e) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(e, '0.5')
    e.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const half = await rate()
  await page.click('.tempo-readout')
  const full = await rate()
  check(`${label}: half speed plays at half the rate`, half > 0 && Math.abs(full / half - 2) < 0.35, `ticks per 2s: 50% -> ${half}, 100% -> ${full}, ratio ${(full / half).toFixed(2)}`)

  // Space pauses
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  check(`${label}: space pauses`, (await page.$eval('.play', (e) => e.getAttribute('aria-label'))) === 'Play')

  // Stop returns to start
  await page.click('button[aria-label="Stop"]')
  await page.waitForTimeout(300)
  check(`${label}: stop returns to start`, (await time()) === '0:00', await time())

  // Track switch
  if (tracks.length > 1) {
    if (viewport.width <= 800) await page.click('.tracks-toggle')
    await page.waitForTimeout(250)
    const before = await page.$eval('.score', (e) => e.innerHTML.length)
    await page.click('.track:nth-child(2) .track-name')
    await page.waitForTimeout(2500)
    const after = await page.$eval('.score', (e) => e.innerHTML.length)
    const active = await page.$eval('.track.active .track-title', (e) => e.textContent)
    check(`${label}: switching track re-renders`, before !== after && active === tracks[1], `active ${active}, markup ${before} -> ${after}`)
    if (viewport.width <= 800) await page.click('.tracks-toggle')
    await page.waitForTimeout(250)
    // mute + solo
    await page.click('.track:nth-child(1) .chip >> nth=0')
    await page.click('.track:nth-child(2) .chip >> nth=1')
    const pressed = await page.$$eval('.chip[aria-pressed=true]', (els) => els.length)
    check(`${label}: mute and solo toggle`, pressed === 2)
    await page.click('.track:nth-child(1) .chip >> nth=0')
    await page.click('.track:nth-child(2) .chip >> nth=1')
    if (viewport.width <= 800) await page.click('.tracks-toggle')
    await page.waitForTimeout(250)
  }

  // Notation toggle
  const h1 = await page.$eval('.score', (e) => e.scrollHeight)
  await page.click('button[title="Notation"]')
  await page.waitForTimeout(3000)
  const h2 = await page.$eval('.score', (e) => e.scrollHeight)
  check(`${label}: notation toggle changes the score`, h2 > h1, `height ${h1} -> ${h2}`)
  await page.screenshot({ path: `${out}${label}-3-notation.png` })
  await page.click('button[title="Notation"]')
  await page.waitForTimeout(3000)

  // Loop selection by dragging over two bars
  const box = await page.$eval('.score', (e) => {
    const r = e.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width }
  })
  const bars = await page.evaluate(() => {
    // find tab number glyph positions is hard; use first system area instead
    const svg = [...document.querySelectorAll('.score svg')].find((s) => s.getBoundingClientRect().height > 60 && s.querySelector('text'))
    return svg ? null : null
  })
  void bars
  // Drag roughly across the first system: find y of first cursor bar by clicking first
  await page.mouse.click(box.x + box.w * 0.3, box.y + 330)
  await page.waitForTimeout(400)
  const cb = await page.$eval('.at-cursor-bar', (e) => {
    const r = e.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }).catch(() => null)
  if (cb && cb.h > 0) {
    const y = cb.y + cb.h / 2
    await page.mouse.move(cb.x + cb.w * 0.5, y)
    await page.mouse.down()
    await page.mouse.move(cb.x + cb.w * 0.9, y, { steps: 5 })
    await page.mouse.move(cb.x + cb.w * 1.6, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    const sel = await page.$$eval('.at-selection div', (els) => els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x: Math.round(r.x), w: Math.round(r.width) }
    }))
    const clear = await page.$('button[title="Clear selection"]')
    check(`${label}: dragging selects a loop range`, sel.length > 0, `cursor bar x=${Math.round(cb.x)} w=${Math.round(cb.w)}; selection ${JSON.stringify(sel)}; clear button ${clear ? 'shown' : 'missing'}`)
    await page.click('button[title="Loop"]')
    await page.screenshot({ path: `${out}${label}-4-loop.png` })
    // play the loop and make sure the position stays inside it
    await page.click('.play')
    const seen = []
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000)
      seen.push(await page.$eval('.seek input', (e) => Number(e.value)))
    }
    let wraps = 0
    for (let i = 1; i < seen.length; i++) if (seen[i] < seen[i - 1]) wraps++
    check(`${label}: loop wraps around`, wraps > 0, `positions(ms) ${seen.join(', ')}`)
    await page.keyboard.press('Space')
    if (clear) {
      await page.click('button[title="Clear selection"]')
      await page.waitForTimeout(300)
      const left = await page.$$eval('.at-selection div', (els) => els.length)
      check(`${label}: clearing removes the selection`, left === 0 && !(await page.$('button[title="Clear selection"]')))
    }
  } else {
    check(`${label}: dragging selects a loop range`, false, `no cursor bar found: ${JSON.stringify(cb)}`)
  }

  // Metronome + count-in toggles
  await page.click('button[title="Metronome"]')
  await page.click('button[title="Count-in"]')
  const on = await page.$$eval('.transport .toggle[aria-pressed=true]', (els) => els.map((e) => e.title))
  check(`${label}: metronome and count-in toggle`, on.includes('Metronome') && on.includes('Count-in'), on.join(', '))

  // Bad file
  await page.setInputFiles('input[type=file]', { name: 'broken.gp5', mimeType: 'application/octet-stream', buffer: Buffer.from('not a tab') })
  await page.waitForSelector('.error', { timeout: 10000 }).catch(() => {})
  const err = await page.textContent('.error').catch(() => null)
  const still = await page.$$eval('.track', (els) => els.length)
  check(`${label}: a bad file shows an error and keeps the song`, !!err && still > 0, err ?? 'no error shown')
  await page.screenshot({ path: `${out}${label}-5-error.png` })

  check(`${label}: no console errors`, errors.length === 0 || errors.every((e) => /import failed|unexpected error|No compatible importer/i.test(e)), errors.slice(0, 5).join(' | '))
  await context.close()
}

await run('desktop-light', { width: 1280, height: 800 }, 'light')
await run('phone-dark', { width: 390, height: 844 }, 'dark')
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
