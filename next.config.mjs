import { AlphaTabWebPackPlugin } from '@coderline/alphatab-webpack'
import fs from 'node:fs'
import os from 'node:os'

/**
 * The sound bank the player loads. GeneralUser GS (32 MB, fetched by
 * `npm run sounds:setup`) is used when it is there; otherwise the 1 MB
 * bank that comes with alphaTab.
 */
const soundBank = fs.existsSync('public/sounds/GeneralUser-GS.sf2')
  ? 'sounds/GeneralUser-GS.sf2'
  : 'soundfont/sonivox.sf3'

/** This computer's addresses on the network, so a phone may load the dev server. */
const networkHosts = Object.values(os.networkInterfaces())
  .flat()
  .filter((address) => address && address.family === 'IPv4' && !address.internal)
  .map((address) => address.address)

/** @type {import('next').NextConfig} */
export default {
  // The app runs entirely in the browser, so the build is plain static files in `out/`.
  output: 'export',
  reactStrictMode: true,
  // Next's badge sits over the bottom-left corner, where the play button is.
  devIndicators: false,
  env: { NEXT_PUBLIC_SOUND_BANK: soundBank },
  allowedDevOrigins: [...networkHosts, '*.local'],
  // Types are checked by `tsc` in the build script.
  typescript: { ignoreBuildErrors: true },
  webpack(config) {
    // Wires up alphaTab's web worker and audio worklet. Its font and sound
    // files are copied into `public/` by scripts/copy-assets.mjs.
    config.plugins.push(new AlphaTabWebPackPlugin({ assetOutputDir: false }))
    return config
  },
}
