// Lets a phone on the same network use the dev server over HTTPS, which the
// iPhone requires for the microphone.
//
// 1. Creates a private certificate authority (once) and a certificate for this
//    computer's network addresses (each run, so a changed address is covered).
// 2. Serves the authority's certificate over plain HTTP so the phone can install
//    it. Stop with Ctrl+C once it is installed.
//
// Everything is written to certs/, which git ignores. The authority's private
// key never leaves this computer; anyone holding it could impersonate websites
// to a phone that trusts it, so keep the folder private.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const dir = path.resolve(import.meta.dirname, '..', 'certs')
const file = (name) => path.join(dir, name)
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] })
fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address)
const host = os.hostname().split('.')[0]
const names = ['localhost', `${host}.local`]
const ips = ['127.0.0.1', ...addresses]

if (!fs.existsSync(file('ca.crt'))) {
  console.log('Creating the certificate authority…')
  openssl('genrsa', '-out', file('ca.key'), '2048')
  fs.chmodSync(file('ca.key'), 0o600)
  openssl(
    'req', '-x509', '-new', '-key', file('ca.key'), '-sha256', '-days', '3650',
    '-subj', '/CN=RiffMaster local development CA',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-out', file('ca.crt'),
  )
}

console.log('Creating the certificate for', [...names, ...ips].join(', '))
fs.writeFileSync(
  file('server.ext'),
  [
    'basicConstraints=CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    `subjectAltName=${[...names.map((n) => `DNS:${n}`), ...ips.map((ip) => `IP:${ip}`)].join(',')}`,
  ].join('\n'),
)
openssl('genrsa', '-out', file('server.key'), '2048')
fs.chmodSync(file('server.key'), 0o600)
openssl('req', '-new', '-key', file('server.key'), '-subj', `/CN=${host}.local`, '-out', file('server.csr'))
// Apple devices accept server certificates valid for at most 825 days.
openssl(
  'x509', '-req', '-in', file('server.csr'), '-CA', file('ca.crt'), '-CAkey', file('ca.key'),
  '-CAcreateserial', '-days', '800', '-sha256', '-extfile', file('server.ext'), '-out', file('server.crt'),
)

// The name the phone shows, read from the authority (older ones were made under the app's first name).
const caName = execFileSync('openssl', ['x509', '-in', file('ca.crt'), '-noout', '-subject', '-nameopt', 'multiline'])
  .toString()
  .match(/commonName\s*=\s*(.+)/)?.[1]
  .trim()

const port = 5174
const page = `<!doctype html><meta name="viewport" content="width=device-width">
<title>RiffMaster certificate</title>
<body style="font:17px system-ui;margin:24px;line-height:1.5">
<h1>RiffMaster on this phone</h1>
<ol>
<li><a href="/riffmaster-ca.crt">Download the certificate</a> and allow the download.</li>
<li>Open <b>Settings</b>, tap <b>Profile Downloaded</b> at the top, and install it.</li>
<li>Open <b>Settings → General → About → Certificate Trust Settings</b> and switch on
<b>${caName}</b>.</li>
<li>Then open ${addresses.map((ip) => `<b>https://${ip}:5180</b>`).join(' or ')} in Safari.</li>
</ol></body>`
http
  .createServer((request, response) => {
    if (request.url === '/riffmaster-ca.crt') {
      response.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="riffmaster-ca.crt"',
      })
      response.end(fs.readFileSync(file('ca.crt')))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(page)
  })
  .listen(port, () => {
    console.log('\nOn the phone, open:')
    for (const ip of addresses) console.log(`  http://${ip}:${port}`)
    console.log('and follow the steps there. Press Ctrl+C when done.')
    console.log('Then start the app with:  npm run dev:phone')
  })
