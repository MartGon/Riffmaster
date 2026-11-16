'use client'

import dynamic from 'next/dynamic'

// The whole app needs the browser (audio, the microphone, stored songs),
// so nothing of it is rendered ahead of time.
const App = dynamic(() => import('../src/App'), { ssr: false })

export default function Page() {
  return <App />
}
