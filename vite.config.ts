import { alphaTab } from '@coderline/alphatab-vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import { defineConfig } from 'vitest/config'

/**
 * With RIFFMASTER_HTTPS=1 (`npm run dev:phone`), the server listens on the
 * network over HTTPS with the certificate from `npm run phone:setup`, so a
 * phone can use the microphone. See docs/phone.md.
 */
const phone = process.env.RIFFMASTER_HTTPS === '1'
const https =
  phone && fs.existsSync('certs/server.crt')
    ? { cert: fs.readFileSync('certs/server.crt'), key: fs.readFileSync('certs/server.key') }
    : undefined
if (phone && !https) throw new Error('No certificate yet: run `npm run phone:setup` first.')

/**
 * The sound bank the player loads. GeneralUser GS (32 MB, fetched by
 * `npm run sounds:setup`) is used when it is there; otherwise the 1 MB
 * bank that comes with alphaTab.
 */
const soundBank = fs.existsSync('public/sounds/GeneralUser-GS.sf2')
  ? 'sounds/GeneralUser-GS.sf2'
  : 'soundfont/sonivox.sf3'

export default defineConfig({
  define: { __SOUND_BANK__: JSON.stringify(soundBank) },
  server: phone ? { host: true, port: 5180, strictPort: true, https } : undefined,
  preview: phone ? { host: true, port: 5180, strictPort: true, https } : undefined,
  plugins: [
    react(),
    // Copies the music font and sound set into the build and wires up
    // alphaTab's web worker and audio worklet.
    alphaTab(),
    // Makes the app installable and usable offline.
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by the app itself, after the sounds have loaded (src/lib/offline.ts).
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'RiffMaster',
        short_name: 'RiffMaster',
        description: 'Play along with guitar tabs.',
        display: 'standalone',
        theme_color: '#c2410c',
        background_color: '#15171a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the font and sound files the app actually requests are stored
        // for offline use; alphaTab ships several alternative formats.
        // The small sound bank is always stored: it is what the player
        // falls back to when the larger one cannot be loaded.
        globPatterns: ['**/*.{js,css,html,svg,png}', 'font/Bravura.woff2', 'soundfont/sonivox.sf3', soundBank],
        globIgnores: ['font/Bravura.svg'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
