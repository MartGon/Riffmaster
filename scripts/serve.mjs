// Serves the built app from out/. `npm run preview` (http, port 4173) or
// `npm run preview:phone` (https on the network, port 5180).
// Options: --port <number>, --phone
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

const root = path.resolve('out')
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('Nothing built yet: run `npm run build` first.')
  process.exit(1)
}
const phone = process.argv.includes('--phone')
const portAt = process.argv.indexOf('--port')
const port = portAt > 0 ? Number(process.argv[portAt + 1]) : phone ? 5180 : 4173

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
}

function handle(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  let file = path.join(root, decodeURIComponent(url.pathname))
  if (!file.startsWith(root)) {
    response.writeHead(403).end()
    return
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`
  if (!fs.existsSync(file)) {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    // The service worker must always be fetched fresh.
    'Cache-Control': path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=0',
  })
  fs.createReadStream(file).pipe(response)
}

let server
if (phone) {
  if (!fs.existsSync('certs/server.crt')) {
    console.error('No certificate yet: run `npm run phone:setup` first.')
    process.exit(1)
  }
  server = https.createServer(
    { cert: fs.readFileSync('certs/server.crt'), key: fs.readFileSync('certs/server.key') },
    handle,
  )
} else {
  server = http.createServer(handle)
}
server.listen(port, phone ? '0.0.0.0' : 'localhost', () => {
  console.log(`Serving out/ at ${phone ? 'https' : 'http'}://localhost:${port}`)
})
