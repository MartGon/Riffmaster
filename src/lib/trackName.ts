/**
 * Splits a track name into the part worth showing first and the rest.
 * Many tab files name tracks "Player | Gear | Instrument"; the last segment
 * is what tells tracks apart, so it becomes the label.
 */
export function splitTrackName(name: string): { label: string; context: string } {
  const parts = name
    .split('|')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  if (parts.length <= 1) return { label: parts[0] ?? name.trim(), context: '' }
  return { label: parts[parts.length - 1], context: parts.slice(0, -1).join(' · ') }
}
