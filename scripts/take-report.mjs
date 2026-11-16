// Prints a report for a take saved from practice mode:
//   npm run take:report -- <file.wav> [--leeway strict|normal|relaxed|loose]
// The app's TypeScript is loaded through Vite, which resolves its imports.
import fs from 'node:fs'
import { createServer } from 'vite'

const LEEWAYS = ['strict', 'normal', 'relaxed', 'loose']

function fail(message) {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
let file = null
let leeway
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--leeway') {
    leeway = args[++i]
    if (!LEEWAYS.includes(leeway)) fail(`--leeway must be one of: ${LEEWAYS.join(', ')}.`)
  } else if (file === null) {
    file = args[i]
  } else {
    fail(`Unexpected argument: ${args[i]}`)
  }
}
if (!file) fail('Usage: npm run take:report -- <file.wav> [--leeway strict|normal|relaxed|loose]')

let bytes
try {
  bytes = new Uint8Array(fs.readFileSync(file))
} catch (error) {
  fail(`Cannot read ${file}: ${error.message}`)
}

// Without the app's config file: its plugins (PWA, alphaTab) are not needed here.
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  logLevel: 'silent',
  optimizeDeps: { noDiscovery: true, include: [] },
})
let text
let error = null
try {
  const { decodeTake } = await server.ssrLoadModule('/src/practice/takeFile.ts')
  const { analyzeTake, formatTakeAnalysis, readTakeReport } = await server.ssrLoadModule('/src/practice/takeReport.ts')
  let take
  try {
    take = decodeTake(bytes)
  } catch (cause) {
    throw new Error(`${file} is not a take file: ${cause.message}`)
  }
  const report = readTakeReport(take.report)
  if (!report) throw new Error(`${file} has no take report inside; save it with the Save take button.`)
  text = formatTakeAnalysis(analyzeTake({ ...take, report }, { leeway }))
} catch (cause) {
  error = cause
} finally {
  await server.close()
}
if (error) fail(error.message)
console.log(text)
