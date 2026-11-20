/** The commit this build was made from, with a "+" for changes not yet committed. */
const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'unknown'

/** When this build was made, as an ISO date. */
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? ''

/** E.g. "Version 882eb98 · built 19 Nov 2026, 14:32", in the viewer's own time. */
export function versionText(): string {
  const built = BUILD_TIME ? new Date(BUILD_TIME) : null
  if (!built || Number.isNaN(built.getTime())) return `Version ${BUILD_VERSION}`
  const when = built.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `Version ${BUILD_VERSION} · built ${when}`
}
