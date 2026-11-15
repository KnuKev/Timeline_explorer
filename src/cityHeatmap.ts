import { longitudeNear, projectLocation } from './mapSpatial.ts'
import { pointDateKeys } from './pointDates.ts'
import type { TimelinePoint } from './timeline.ts'

export type HeatCell = { lat: number; lng: number; days: number }
const CELL_METRES = 200
const EQUATOR_METRES = 40_075_017

export function buildCityHeatCells(points: readonly TimelinePoint[], dates: readonly string[]): HeatCell[] {
  if (!points.length || !dates.length) return []
  const includedDays = new Set(dates)
  const reference = points[0]!
  const latitude = Math.max(-85, Math.min(85, reference.lat))
  const cellSize = CELL_METRES / (EQUATOR_METRES * Math.cos(latitude * Math.PI / 180))
  const cells = new Map<string, { lat: number; lng: number; count: number; days: Set<string> }>()

  for (const point of points) {
    const pointDays = pointDateKeys(point).filter(day => includedDays.has(day))
    if (!pointDays.length) continue

    const lng = longitudeNear(point.lng, reference.lng)
    const position = projectLocation(point.lat, lng)
    const key = `${Math.floor(position.x / cellSize)}:${Math.floor(position.y / cellSize)}`
    const cell = cells.get(key) ?? { lat: 0, lng: 0, count: 0, days: new Set<string>() }
    cell.lat += point.lat
    cell.lng += lng
    cell.count++
    for (const day of pointDays) cell.days.add(day)
    cells.set(key, cell)
  }
  return Array.from(cells.values(), cell => ({ lat: cell.lat / cell.count, lng: cell.lng / cell.count, days: cell.days.size }))
}

export function createHeatColorRamp(element: HTMLElement) {
  const style = getComputedStyle(element)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) return undefined
  const gradient = context.createLinearGradient(.5, 0, 255.5, 0)
  for (let level = 1; level <= 5; level++) {
    gradient.addColorStop((level - 1) / 4, style.getPropertyValue(`--heat-${level}`).trim())
  }
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 1)
  return context.getImageData(0, 0, 256, 1).data
}

export function createHeatKernel() {
  const kernel = document.createElement('canvas')
  kernel.width = kernel.height = 64
  const context = kernel.getContext('2d')
  if (!context) return kernel
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, '#000')
  gradient.addColorStop(.45, '#0008')
  gradient.addColorStop(1, '#0000')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return kernel
}

export function drawCityHeatmap(context: CanvasRenderingContext2D, kernel: HTMLCanvasElement, colorRamp: Uint8ClampedArray, cells: readonly HeatCell[],
  size: { x: number; y: number }, project: (cell: HeatCell) => { x: number; y: number }) {
  if (!cells.length) return
  const radius = 27
  const maxDays = cells.reduce((max, cell) => Math.max(max, cell.days), 4)
  const peak = Math.log1p(maxDays)
  context.globalCompositeOperation = 'lighter'
  for (const cell of cells) {
    const { x, y } = project(cell)
    if (x < -radius || y < -radius || x > size.x + radius || y > size.y + radius) continue
    context.globalAlpha = .18 + .82 * Math.log1p(cell.days) / peak
    context.drawImage(kernel, x - radius, y - radius, radius * 2, radius * 2)
  }
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const strength = pixels.data[index + 3]!
    if (!strength) continue
    const color = strength * 4
    pixels.data[index] = colorRamp[color]!
    pixels.data[index + 1] = colorRamp[color + 1]!
    pixels.data[index + 2] = colorRamp[color + 2]!
    pixels.data[index + 3] = Math.min(215, strength * 2.1)
  }
  context.putImageData(pixels, 0, 0)
}
