// Copies alphaTab's music font and small sound bank into public/, where the
// app loads them from. Run before the dev server and before a build.
// With --phone it also checks that the HTTPS certificate exists.
import fs from 'node:fs'

const from = new URL('../node_modules/@coderline/alphatab/dist/', import.meta.url)
const to = new URL('../public/', import.meta.url)
for (const folder of ['font', 'soundfont']) {
  fs.cpSync(new URL(`${folder}/`, from), new URL(`${folder}/`, to), { recursive: true })
}

if (process.argv.includes('--phone') && !fs.existsSync(new URL('../certs/server.crt', import.meta.url))) {
  console.error('No certificate yet: run `npm run phone:setup` first.')
  process.exit(1)
}
