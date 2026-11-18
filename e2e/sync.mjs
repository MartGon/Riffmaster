// The optional sync: the app starts without loading any of it, the sign-in
// form opens, and a wrong password is reported. Needs a build or dev server
// given a Supabase project in .env.local. `node sync.mjs [url]`
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5199/'
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
const calls = []
page.on('request', (r) => /supabase\.co/.test(r.url()) && calls.push(r.url()))

await page.goto(url)
await page.waitForSelector('.library')
await page.waitForTimeout(1500)
const button = await page.$('.sync-button')
check('the top bar has a sync button', button !== null)
check('it says sync is off', (await button?.getAttribute('title')) === 'Sync is off', await button?.getAttribute('title'))
check('nothing is sent to Supabase before signing in', calls.length === 0, calls.join(', '))

await button.click()
await page.waitForSelector('dialog[open] input[type=email]')
await page.screenshot({ path: `${out}sync-signin.png` })
await page.fill('input[type=email]', 'nobody@example.invalid')
await page.fill('input[type=password]', 'not-the-password')
await page.click('dialog button[type=submit]')
await page.waitForSelector('dialog .dialog-error', { timeout: 15000 }).catch(() => {})
const problem = await page.$eval('dialog .dialog-error', (e) => e.textContent).catch(() => null)
check('a wrong password is reported', problem === 'Wrong email or password.', problem ?? 'no message')
await page.click('dialog button:has-text("Cancel")')
check('the library still works after a failed sign-in', (await page.$('.library')) !== null && (await page.$('dialog[open]')) === null)

check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
