// The theme switch: system, light and dark; remembered across reloads; the score re-coloured.
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5199/'
const out = new URL('.', import.meta.url).pathname
const SAMPLE = new URL('../samples/californication.gp', import.meta.url).pathname
const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
}

const LIGHT_BG = 'rgb(244, 242, 238)'
const DARK_BG = 'rgb(21, 23, 26)'

const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const background = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? 'system')
const toggle = 'button[aria-label^="Theme:"]'
/** Colour of the tab's text, as alphaTab draws it. */
const scoreInk = () =>
  page.evaluate(() => {
    const text = document.querySelector('.score svg text')
    return text ? (text.getAttribute('fill') ?? getComputedStyle(text).fill) : null
  })

await page.goto(url)
await page.waitForSelector(toggle)
check('starts on the system theme', (await theme()) === 'system')
check('system light shows light colours', (await background()) === LIGHT_BG, await background())

await page.setInputFiles('input[type=file]', SAMPLE)
await page.waitForFunction(() => document.querySelectorAll('.score svg text').length > 0, null, { timeout: 30000 })
const lightInk = await scoreInk()

await page.click(toggle)
check('first click chooses light', (await theme()) === 'light')
await page.click(toggle)
check('second click chooses dark', (await theme()) === 'dark')
check('dark colours show', (await background()) === DARK_BG, await background())
await page.waitForFunction((before) => {
  const text = document.querySelector('.score svg text')
  return text && (text.getAttribute('fill') ?? getComputedStyle(text).fill) !== before
}, lightInk, { timeout: 10000 }).catch(() => {})
const darkInk = await scoreInk()
check('score is drawn again in dark colours', darkInk !== lightInk, `${lightInk} -> ${darkInk}`)
await page.screenshot({ path: `${out}theme-dark.png` })

// The choice is applied before the app starts, so there is no flash of light.
await page.reload()
const early = await page.evaluate(() => document.documentElement.dataset.theme)
check('dark is remembered after a reload', early === 'dark')
await page.waitForSelector(toggle)
check('dark colours after the reload', (await background()) === DARK_BG)

// A chosen theme wins over the system's.
await page.emulateMedia({ colorScheme: 'dark' })
await page.click(toggle)
check('third click goes back to the system theme', (await theme()) === 'system')
check('system dark shows dark colours', (await background()) === DARK_BG)
await page.click(toggle)
check('light overrides a dark system', (await background()) === LIGHT_BG, await background())
await page.screenshot({ path: `${out}theme-light-over-dark.png` })

// Another tab follows the choice.
const other = await context.newPage()
await other.goto(url)
await other.waitForSelector(toggle)
await page.click(toggle)
await other.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 }).catch(() => {})
check('another open tab follows the choice', (await other.evaluate(() => document.documentElement.dataset.theme)) === 'dark')

check('no errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
