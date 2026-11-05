import type { TimelinePoint } from './timeline.ts'
import type { RouteSegment } from './routes.ts'

export type WorldPoint = { x: number; y: number }
export type WorldRect = { west: number; east: number; north: number; south: number }
type Entry = WorldPoint & { point: TimelinePoint; order: number }
type Node = WorldRect & { start: number; end: number; left?: Node; right?: Node }
const LEAF_SIZE = 32

export function projectLocation(lat: number, lng: number): WorldPoint {
  const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180)
  return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) }
}

export function worldRectsForBounds(bounds: { west: number; east: number; north: number; south: number }): WorldRect[] {
  const north = projectLocation(bounds.north, 0).y
  const south = projectLocation(bounds.south, 0).y
  let width = bounds.east - bounds.west
  if (width < 0) width = ((width % 360) + 360) % 360
  if (width >= 360) return [{ west: 0, east: 1, north, south }]
  const west = (((bounds.west + 180) / 360) % 1 + 1) % 1
  const east = west + width / 360
  return east <= 1 ? [{ west, east, north, south }] : [{ west, east: 1, north, south }, { west: 0, east: east - 1, north, south }]
}

function overlaps(a: WorldRect, b: WorldRect): boolean {
  return a.west <= b.east && a.east >= b.west && a.north <= b.south && a.south >= b.north
}

function contains(rect: WorldRect, point: WorldPoint): boolean {
  return point.x >= rect.west && point.x <= rect.east && point.y >= rect.north && point.y <= rect.south
}

function selectMedian(entries: Entry[], start: number, end: number, median: number, axis: 'x' | 'y') {
  let left = start
  let right = end - 1
  while (left < right) {
    const pivot = entries[(left + right) >>> 1]![axis]
    let low = left
    let high = right
    while (low <= high) {
      while (entries[low]![axis] < pivot) low++
      while (entries[high]![axis] > pivot) high--
      if (low <= high) {
        const entry = entries[low]!
        entries[low++] = entries[high]!
        entries[high--] = entry
      }
    }
    if (median <= high) right = high
    else if (median >= low) left = low
    else break
  }
}

/** Static index of immutable display points. Exact duplicate coordinates share a
 * dot; the latest source occurrence wins a click just as the old linear scan did. */
export function createPointSpatialIndex(points: readonly TimelinePoint[]) {
  const unique = new Map<string, Entry>()
  points.forEach((point, order) => {
    const key = `${point.lat}:${point.lng}`
    const existing = unique.get(key)
    if (existing) { existing.point = point; existing.order = order; return }
    const position = projectLocation(point.lat, point.lng)
    unique.set(key, { x: position.x, y: position.y, point, order })
  })
  const entries = [...unique.values()]
  const build = (start: number, end: number, depth = 0): Node => {
    const node: Node = { start, end, west: Infinity, east: -Infinity, north: Infinity, south: -Infinity }
    if (end - start > LEAF_SIZE) {
      const median = (start + end) >>> 1
      selectMedian(entries, start, end, median, depth % 2 === 0 ? 'x' : 'y')
      node.left = build(start, median, depth + 1)
      node.right = build(median, end, depth + 1)
      node.west = Math.min(node.left.west, node.right.west)
      node.east = Math.max(node.left.east, node.right.east)
      node.north = Math.min(node.left.north, node.right.north)
      node.south = Math.max(node.left.south, node.right.south)
    } else {
      for (let index = start; index < end; index++) {
        const entry = entries[index]!
        node.west = Math.min(node.west, entry.x)
        node.east = Math.max(node.east, entry.x)
        node.north = Math.min(node.north, entry.y)
        node.south = Math.max(node.south, entry.y)
      }
    }
    return node
  }
  const root = entries.length ? build(0, entries.length) : null

  const query = (rect: WorldRect): TimelinePoint[] => {
    const result: TimelinePoint[] = []
    const visit = (node: Node) => {
      if (!overlaps(node, rect)) return
      if (node.left && node.right) { visit(node.left); visit(node.right); return }
      for (let index = node.start; index < node.end; index++) if (contains(rect, entries[index]!)) result.push(entries[index]!.point)
    }
    if (root) visit(root)
    return result
  }

  const sample = (rects: WorldRect[], cellSize: number, maximum = 8000): TimelinePoint[] => {
    if (!Number.isFinite(cellSize) || cellSize <= 0 || maximum < 1) return []
    const cells = new Map<string, Entry>()
    const add = (entry: Entry) => {
      const key = `${Math.floor(entry.x / cellSize)}:${Math.floor(entry.y / cellSize)}`
      const previous = cells.get(key)
      if (!previous || entry.order > previous.order) cells.set(key, entry)
    }
    const visit = (node: Node, rect: WorldRect) => {
      if (!overlaps(node, rect)) return
      if (node.west >= rect.west && node.east <= rect.east && node.north >= rect.north && node.south <= rect.south && node.east - node.west <= cellSize && node.south - node.north <= cellSize) {
        add(entries[node.start]!)
        return
      }
      if (node.left && node.right) { visit(node.left, rect); visit(node.right, rect); return }
      for (let index = node.start; index < node.end; index++) if (contains(rect, entries[index]!)) add(entries[index]!)
    }
    if (root) for (const rect of rects) visit(root, rect)
    const candidates = [...cells.values()]
    if (candidates.length <= maximum) return candidates.map(entry => entry.point)
    return Array.from({ length: maximum }, (_, index) => candidates[Math.floor(index * candidates.length / maximum)]!.point)
  }

  const nearest = (pointer: WorldPoint, radius: number): TimelinePoint | null => {
    if (!root || !Number.isFinite(radius) || radius < 0 || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null
    let best = radius * radius
    let result: Entry | undefined
    const visit = (node: Node, x: number) => {
      const dx = Math.max(node.west - x, 0, x - node.east)
      const dy = Math.max(node.north - pointer.y, 0, pointer.y - node.south)
      if (dx * dx + dy * dy > best) return
      if (node.left && node.right) {
        const leftCenter = (node.left.west + node.left.east) / 2
        const rightCenter = (node.right.west + node.right.east) / 2
        if (Math.abs(leftCenter - x) <= Math.abs(rightCenter - x)) { visit(node.left, x); visit(node.right, x) }
        else { visit(node.right, x); visit(node.left, x) }
        return
      }
      for (let index = node.start; index < node.end; index++) {
        const entry = entries[index]!
        const squared = (entry.x - x) ** 2 + (entry.y - pointer.y) ** 2
        if (squared < best || (squared === best && (!result || entry.order > result.order))) {
          best = squared
          result = entry
        }
      }
    }
    const x = pointer.x >= 0 && pointer.x <= 1 ? pointer.x : ((pointer.x % 1) + 1) % 1
    visit(root, x)
    if (x - radius < 0) visit(root, x + 1)
    if (x + radius > 1) visit(root, x - 1)
    return result?.point ?? null
  }

  return { query, sample, nearest, size: entries.length }
}

type ProjectedRoute = { points: TimelinePoint[]; x: Float64Array; y: Float64Array; bounds: WorldRect }
export type RoutePositions = [number, number][][]

function simplifyRoute(route: ProjectedRoute, tolerance: number): [number, number][] {
  const { points, x, y } = route
  if (points.length <= 2) return points.map(point => [point.lat, point.lng])
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [0, points.length - 1]
  const squaredTolerance = tolerance * tolerance
  while (stack.length) {
    const end = stack.pop()!
    const start = stack.pop()!
    const dx = x[end]! - x[start]!
    const dy = y[end]! - y[start]!
    const length = dx * dx + dy * dy
    let furthest = -1
    let maximum = squaredTolerance
    for (let index = start + 1; index < end; index++) {
      const t = length ? Math.max(0, Math.min(1, ((x[index]! - x[start]!) * dx + (y[index]! - y[start]!) * dy) / length)) : 0
      const distance = (x[index]! - x[start]! - t * dx) ** 2 + (y[index]! - y[start]! - t * dy) ** 2
      if (distance > maximum) { maximum = distance; furthest = index }
    }
    if (furthest >= 0) { keep[furthest] = 1; stack.push(start, furthest, furthest, end) }
  }
  const result: [number, number][] = []
  points.forEach((point, index) => { if (keep[index]) result.push([point.lat, point.lng]) })
  return result
}

/** Display-only simplification retains observed anchors and every segment's ends.
 * The exact route and distance remain untouched. Caches are limited to three zooms. */
export function createRouteGeometry(segments: readonly RouteSegment[]) {
  const projected: ProjectedRoute[] = segments.map(segment => {
    const x = new Float64Array(segment.points.length)
    const y = new Float64Array(segment.points.length)
    const bounds = { west: Infinity, east: -Infinity, north: Infinity, south: -Infinity }
    segment.points.forEach((point, index) => {
      const position = projectLocation(point.lat, point.lng)
      x[index] = position.x
      y[index] = position.y
      bounds.west = Math.min(bounds.west, position.x)
      bounds.east = Math.max(bounds.east, position.x)
      bounds.north = Math.min(bounds.north, position.y)
      bounds.south = Math.max(bounds.south, position.y)
    })
    return { points: segment.points, x, y, bounds }
  })
  const cache = new Map<number, Map<number, [number, number][]>>()
  return {
    visible(zoom: number, rects: WorldRect[]): RoutePositions {
      const level = Math.max(0, Math.min(24, Math.ceil(zoom)))
      let atZoom = cache.get(level)
      if (!atZoom) {
        atZoom = new Map()
        cache.set(level, atZoom)
        if (cache.size > 3) cache.delete(cache.keys().next().value!)
      }
      const result: RoutePositions = []
      projected.forEach((route, index) => {
        if (!rects.some(rect => overlaps(route.bounds, rect))) return
        let positions = atZoom!.get(index)
        if (!positions) {
          positions = simplifyRoute(route, 0.75 / (256 * 2 ** level))
          atZoom!.set(index, positions)
        }
        if (positions.length > 1) result.push(positions)
      })
      return result
    },
  }
}
