import type * as alphaTab from '@coderline/alphatab'

/**
 * The bar drawn at a point of the score (in the score's own coordinates),
 * or null between lines and outside the tab.
 */
export function barAtPoint(api: alphaTab.AlphaTabApi, x: number, y: number): number | null {
  for (const system of api.boundsLookup?.staffSystems ?? []) {
    const box = system.realBounds
    if (y < box.y || y > box.y + box.h) continue
    for (const bar of system.bars) {
      const area = bar.realBounds
      if (x >= area.x && x <= area.x + area.w) return bar.index
    }
  }
  return null
}
