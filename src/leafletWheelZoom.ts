import L from 'leaflet'

const TRACKPAD_PIXELS_PER_LEVEL = 240
const MAX_DELTA_PER_EVENT = 1
const DURATION_SECONDS = .16

export function addSmoothWheelZoom(map: L.Map) {
  const container = map.getContainer()
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let target: number | undefined
  let cursor: L.Point | undefined
  let frame: number | undefined

  const reset = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    target = cursor = frame = undefined
  }

  function zoomToCursor() {
    frame = undefined
    if (target === undefined || !cursor) return
    if (Math.abs(map.getZoom() - target) < .001) { reset(); return }
    if (reducedMotion.matches || !L.Browser.any3d) {
      map.setZoomAround(cursor, target, { animate: false })
      return
    }

    const anchor = map.containerPointToLatLng(cursor)
    const offset = cursor.subtract(map.getSize().divideBy(2))
    const center = map.unproject(map.project(anchor, target).subtract(offset), target)
    map.flyTo(center, target, { duration: DURATION_SECONDS, noMoveStart: true })
  }

  const handleWheel = (event: WheelEvent) => {
    const delta = L.DomEvent.getWheelDelta(event)
    if (!delta) return
    event.preventDefault()
    const step = Math.max(-MAX_DELTA_PER_EVENT, Math.min(MAX_DELTA_PER_EVENT, delta / TRACKPAD_PIXELS_PER_LEVEL))
    target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), (target ?? map.getZoom()) + step))
    cursor = map.mouseEventToContainerPoint(event)
    if (frame === undefined) frame = requestAnimationFrame(zoomToCursor)
  }

  container.addEventListener('wheel', handleWheel, { passive: false })
  map.on('zoomend dragstart', reset)
  return () => {
    reset()
    map.off('zoomend dragstart', reset)
    container.removeEventListener('wheel', handleWheel)
  }
}
