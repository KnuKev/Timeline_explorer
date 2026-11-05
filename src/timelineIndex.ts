import type { TimelinePoint } from './timeline.ts'
import { pointDateKeys } from './pointDates.ts'
import { analysePointQuality, type SuspectedPoint } from './pointQuality.ts'

export type IndexedDay = { day: string; indices: Uint32Array; cleanCount: number }
export type TimelineDataset = { points: TimelinePoint[]; cleanPoints: TimelinePoint[]; excluded: SuspectedPoint[]; days: IndexedDay[] }

export function prepareTimeline(points: TimelinePoint[]): TimelineDataset {
  const quality = analysePointQuality(points)
  const excluded = new Set(quality.excluded.map(entry => entry.point.id))
  const byDay = new Map<string, { indices: number[]; cleanCount: number }>()
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    for (const day of pointDateKeys(point)) {
      const entry = byDay.get(day) ?? { indices: [], cleanCount: 0 }
      entry.indices.push(index)
      if (!excluded.has(point.id)) entry.cleanCount++
      byDay.set(day, entry)
    }
  }
  return { points, cleanPoints: quality.points, excluded: quality.excluded,
    days: Array.from(byDay, ([day, value]) => ({ day, indices: Uint32Array.from(value.indices), cleanCount: value.cleanCount })).sort((a, b) => a.day.localeCompare(b.day)) }
}

function lowerBound(days: IndexedDay[], day: string): number {
  let left = 0
  let right = days.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (days[middle]!.day < day) left = middle + 1
    else right = middle
  }
  return left
}

export function selectTimelineRange(dataset: TimelineDataset, from: string, to: string, includeSuspect = false): TimelinePoint[] {
  if (!from || !to || from > to) return []
  const excluded = includeSuspect ? new Set<string>() : new Set(dataset.excluded.map(entry => entry.point.id))
  const indices = new Set<number>()
  for (let dayIndex = lowerBound(dataset.days, from); dayIndex < dataset.days.length; dayIndex++) {
    const entry = dataset.days[dayIndex]!
    if (entry.day > to) break
    for (const index of entry.indices) if (!excluded.has(dataset.points[index]!.id)) indices.add(index)
  }
  return Array.from(indices).sort((a, b) => a - b).map(index => dataset.points[index]!)
}

export function groupTimelineSelection(dataset: TimelineDataset, selection: TimelinePoint[], from?: string, to?: string): { day: string; points: TimelinePoint[] }[] {
  const ids = new Set(selection.map(point => point.id))
  const groups = []
  for (let index = from ? lowerBound(dataset.days, from) : 0; index < dataset.days.length; index++) {
    const entry = dataset.days[index]!
    if (to && entry.day > to) break
    const points = Array.from(entry.indices).filter(index => ids.has(dataset.points[index]!.id)).map(index => dataset.points[index]!)
    if (points.length) groups.push({ day: entry.day, points })
  }
  return groups
}

export function adjacentRecordedDay(days: string[], selected: string, direction: -1 | 1): string | undefined {
  let left = 0
  let right = days.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (days[middle]! < selected || (direction === 1 && days[middle] === selected)) left = middle + 1
    else right = middle
  }
  return days[direction === -1 ? left - 1 : left]
}
