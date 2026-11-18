import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '../src/index.css'
import { themeBootScript } from '../src/lib/theme'

export const metadata: Metadata = {
  title: 'RiffMaster',
  description: 'Play along with guitar tabs.',
  manifest: '/manifest.webmanifest',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' }, apple: '/icon-192.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The script below may set data-theme before React takes over, hence suppressHydrationWarning.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
