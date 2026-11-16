// Writes the service worker that makes the built app installable and usable
// offline. Run after `next build`, over the static files in out/.
import fs from 'node:fs'
import { generateSW } from 'workbox-build'

const soundBank = fs.existsSync('public/sounds/GeneralUser-GS.sf2')
  ? 'sounds/GeneralUser-GS.sf2'
  : 'soundfont/sonivox.sf3'

const { count, size, warnings } = await generateSW({
  globDirectory: 'out',
  swDest: 'out/sw.js',
  // Only the font and sound files the app actually requests are stored
  // for offline use; alphaTab ships several alternative formats.
  // The small sound bank is always stored: it is what the player falls
  // back to when the larger one cannot be loaded.
  globPatterns: [
    '**/*.{js,css,html,svg,png,webmanifest}',
    'font/Bravura.woff2',
    'soundfont/sonivox.sf3',
    soundBank,
  ],
  globIgnores: ['font/Bravura.svg', 'sw.js', 'workbox-*.js'],
  maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
  navigateFallback: '/index.html',
  // A new version takes over as soon as it has been downloaded.
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
})
for (const warning of warnings) console.warn(warning)
console.log(`Offline store: ${count} files, ${(size / 1024 / 1024).toFixed(1)} MB`)
