/** The smallest of 1, 2, 2.5, 5 times a power of ten that is at least `value`. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= value) ?? 10) * magnitude
}
