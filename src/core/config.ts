export const DEFAULT_INTERVAL_MS = 600000

// The interval divides every block and schedule calculation, so a zero or
// unparseable value would yield Infinity or NaN and stall tracking silently.
// Anything invalid falls back to the default rather than propagating.
export const parseIntervalMs = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_INTERVAL_MS

  const trimmed = raw.trim()
  if (trimmed === '') return DEFAULT_INTERVAL_MS

  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS

  return parsed
}
