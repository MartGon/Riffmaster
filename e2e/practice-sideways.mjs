// A practice take with the phone held sideways: the top bar, the controls and the
// practice panel step aside, a floating Stop and the live count take their place,
// and everything comes back when the take is stopped. Held upright, the panel stays.
// Uses the browser's fake microphone. `node practice-sideways.mjs [url]`
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5199/'
const out = new URL('.', import.meta.url).pathname
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
const shown = (page, selector) =>
  page.$eval(selector, (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).catch(() => false)

for (const [label, viewport] of [['sideways', { width: 844, height: 390 }], ['upright', { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, permissions: ['microphone'] })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(url)
  await page.waitForSelector('.library')
  await page.setInputFiles('input[type=file]', new URL('../samples/californication.gp', import.meta.url).pathname)
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 60000 })
  await page.click('button[title="Practice"]')
  await page.waitForSelector('.practice button:has-text("Start practice"):not([disabled])', { timeout: 15000 })
  await page.click('.practice button:has-text("Start practice")')
  await page.waitForTimeout(2500)

  if (label === 'sideways') {
    check('sideways: the top bar steps aside', !(await shown(page, '.topbar')))
    check('sideways: the controls step aside', !(await shown(page, '.transport')))
    check('sideways: the practice panel steps aside', !(await shown(page, '.practice')))
    check('sideways: a floating Stop is there', await shown(page, '.float-practice button[aria-label="Stop practice"]'))
    await page.waitForSelector('.float-live', { timeout: 5000 }).catch(() => {})
    check('sideways: the live count is there', await shown(page, '.float-live'), await page.$eval('.float-live', (e) => e.textContent).catch(() => 'none'))
    await page.screenshot({ path: `${out}practice-sideways.png` })
    await page.click('.float-practice button')
    await page.waitForTimeout(1500)
    check('sideways: Stop brings the controls back', (await shown(page, '.topbar')) && (await shown(page, '.transport')) && (await shown(page, '.practice')))
    check('sideways: the floating Stop is gone', !(await shown(page, '.float-practice')))
    await page.screenshot({ path: `${out}practice-sideways-stopped.png` })
  } else {
    check('upright: the practice panel stays during a take', (await shown(page, '.practice')) && (await shown(page, '.transport')))
    check('upright: no floating Stop', !(await shown(page, '.float-practice')))
    await page.click('.practice button:has-text("Stop")')
  }
  check(`${label}: no errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
  await context.close()
}
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
