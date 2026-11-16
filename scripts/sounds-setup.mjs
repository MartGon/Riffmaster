// Downloads the GeneralUser GS sound bank (about 32 MB), which sounds much
// fuller than the 1 MB bank that comes with alphaTab. `npm run sounds:setup`
//
// The file is not kept in git. Without it the app uses the small bank.
// To go back to the small bank, remove public/sounds/ and restart.
//
// GeneralUser GS is by S. Christian Collins and is free to use and to
// redistribute: https://www.schristiancollins.com/generaluser.php
import fs from 'node:fs'
import path from 'node:path'

const source = 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/'
const folder = new URL('../public/sounds/', import.meta.url).pathname
const files = [
  { from: 'GeneralUser-GS.sf2', to: 'GeneralUser-GS.sf2', least: 30_000_000 },
  { from: 'documentation/LICENSE.txt', to: 'GeneralUser-GS-LICENSE.txt', least: 1000 },
]

fs.mkdirSync(folder, { recursive: true })
for (const file of files) {
  const target = path.join(folder, file.to)
  if (fs.existsSync(target) && fs.statSync(target).size >= file.least) {
    console.log(`${file.to} is already there`)
    continue
  }
  console.log(`Downloading ${file.to} …`)
  const response = await fetch(source + file.from)
  if (!response.ok) throw new Error(`${file.from}: the download failed (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < file.least) throw new Error(`${file.from}: the download is incomplete (${bytes.length} bytes)`)
  // Written under another name first, so a broken download is never used.
  fs.writeFileSync(`${target}.part`, bytes)
  fs.renameSync(`${target}.part`, target)
  console.log(`  ${(bytes.length / 1_000_000).toFixed(1)} MB`)
}
console.log('Done. Restart the dev server (or build again) to use it.')
