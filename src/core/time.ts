export const startOfLocalDay = (ts: number): number => {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}
