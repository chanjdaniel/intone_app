import { Schema } from 'effect'
import { Calendar } from 'foldkit'

// Dates and shares as the history screens say them.

// The learner's day, as `YYYY-MM-DD`.
export const isoDayOf = Schema.encodeSync(Calendar.CalendarDateFromIsoString)

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export const monthName = (month: number): string => monthNames[month - 1] ?? ''

// `2026-11-09` as "9 November 2026".
export const dayText = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-').map(Number)
  return `${day ?? ''} ${monthName(month ?? 0)} ${year ?? ''}`
}

export const monthText = (date: Calendar.CalendarDate): string =>
  `${monthName(date.month)} ${date.year}`

export const percentText = (share: number): string =>
  `${Math.round(100 * Math.min(1, Math.max(0, share)))}%`

export const countText = (
  count: number,
  one: string,
  many: string = `${one}s`,
): string => `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`

// Bytes as the settings screen says them: "2.3 MB".
export const bytesText = (bytes: number): string => {
  if (bytes < 1000) {
    return `${bytes} bytes`
  }
  const units = ['kB', 'MB', 'GB', 'TB'] as const
  const step = Math.min(units.length, Math.floor(Math.log10(bytes) / 3))
  const value = bytes / 1000 ** step
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[step - 1] ?? 'TB'}`
}
