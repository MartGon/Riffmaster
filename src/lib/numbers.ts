/** Parses a whole number from a form field, or returns null when it is not one within the limits. */
export function wholeNumber(value: string | undefined, min: number, max: number): number | null {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) return null
  return number
}
