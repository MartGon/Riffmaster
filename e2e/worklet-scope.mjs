// The cause of silent Play on iPhones: Next.js ends each script with `_N_E = ...`,
// which throws inside alphaTab's audio worklet unless the app declares `_N_E`
// there first (prepareWorkletScope in src/player/usePlayer.ts). Safari's engine then
// never registers alphaTab's processor. Chromium carries on, so this checks the
// line itself: after Play, `_N_E` must hold a value in the worklet.
// `node worklet-scope.mjs [url]`, against the built app on port 5198 or the dev server.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:5198/'
const browser = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
await context.addInitScript(() => {
  const Real = window.AudioContext
  window.__contexts = []
  window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__contexts.push(this) } }
})
const page = await context.newPage()
const errors = []
page.on('console', (m) => /_N_E|ReferenceError/.test(m.text()) && errors.push(m.text()))
await page.goto(url)
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', new URL('formats/guitarpro7-serenade.gp', import.meta.url).pathname)
await page.waitForFunction(() => !document.querySelector('.play')?.disabled, null, { timeout: 30000 })
await page.click('.play')
await page.waitForTimeout(1500)
const found = await page.evaluate(async () => {
  const ctx = window.__contexts.at(-1)
  const code = `registerProcessor('probe-nne', class extends AudioWorkletProcessor { constructor(){ super(); this.port.postMessage(typeof globalThis._N_E + ' / own property: ' + Object.prototype.hasOwnProperty.call(globalThis, '_N_E')) } process(){ return false } })`
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
  const node = new AudioWorkletNode(ctx, 'probe-nne')
  return await new Promise((r) => { node.port.onmessage = (e) => r(e.data) })
})
const ok = found.startsWith('object') && errors.length === 0
console.log(`${ok ? 'PASS' : 'FAIL'}  alphaTab's worklet files run to the end  (_N_E: ${found}${errors.length ? `; ${errors[0]}` : ''})`)
await browser.close()
process.exit(ok ? 0 : 1)
