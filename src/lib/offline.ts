let started = false

/**
 * Starts storing the app for offline use. Called once the instrument
 * sounds are in: the store downloads them too, and two downloads of the
 * large sound bank at once made the page's own one fail on a first visit.
 * Only the built app has anything to store.
 */
export function startOfflineStore(): void {
  if (started || process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
  started = true
  // Without the store the app still works while online.
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
}
