import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '../src/index.css'

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
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
