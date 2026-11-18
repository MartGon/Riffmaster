import { useEffect } from 'react'

/**
 * Keeps the screen from dimming and locking while `active`, e.g. while a
 * song is open: the tab is read between plays too, with both hands on the
 * guitar. Uses the Screen Wake Lock API (iPhones since iOS 16.4). The
 * system lets go of the lock whenever the page is hidden, so it is asked
 * for again when the page comes back. Where the browser does not offer it,
 * or refuses (e.g. in Low Power Mode), the screen behaves as usual.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let wanted = true
    let asking = false

    const request = async () => {
      if (!wanted || asking || document.visibilityState !== 'visible' || (lock && !lock.released)) return
      asking = true
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        // Left the song while the request was on its way.
        if (!wanted) void sentinel.release().catch(() => {})
        else lock = sentinel
      } catch {
        // Refused: the screen locks as usual.
      } finally {
        asking = false
      }
    }
    const onVisible = () => void request()
    // Some browsers only grant it after a tap, so a tap asks again if needed.
    const onTap = () => void request()

    void request()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pointerdown', onTap)
    return () => {
      wanted = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pointerdown', onTap)
      if (lock && !lock.released) void lock.release().catch(() => {})
      lock = null
    }
  }, [active])
}
