import { useEffect, useState, useSyncExternalStore } from 'react'
import { debugEnabled, debugLines, onDebug, startDebugLog } from '../lib/debugLog'

const noChanges = () => () => {}

/** The `?debug` log, at the bottom of the screen, with a button to copy it. */
export function DebugPanel() {
  const lines = useSyncExternalStore(onDebug, debugLines, debugLines)
  // Read after hydration only: the server-made page never has the log.
  const on = useSyncExternalStore(noChanges, debugEnabled, () => false)
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (on) startDebugLog()
  }, [on])
  if (!on) return null
  const text = lines.join('\n')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Selecting the text by hand still works.
    }
  }
  return (
    <div className="debug-panel">
      <div className="debug-buttons">
        <strong>Debug log</strong>
        <button type="button" className="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="button" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && <pre>{text}</pre>}
    </div>
  )
}
