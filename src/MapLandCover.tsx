import { useEffect } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import landCoverUrl from './assets/world-land-cover.webp'

// Natural Earth I with Shaded Relief (1:50m), projected to Web Mercator.
// White water areas leave the OpenStreetMap colours underneath intact.
let landCover: Promise<HTMLImageElement> | undefined

function loadLandCover() {
  if (!landCover) {
    const image = new Image()
    image.src = landCoverUrl
    landCover = image.decode().then(() => image).catch(error => {
      landCover = undefined
      throw error
    })
  }
  return landCover
}

class LandCoverLayer extends L.GridLayer {
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLCanvasElement {
    const tile = document.createElement('canvas')
    const size = this.getTileSize()
    tile.width = size.x
    tile.height = size.y
    loadLandCover().then(image => {
      // Leaflet passes wrapped tile coordinates, so repeated worlds use the same image.
      const sourceSize = image.naturalWidth / 2 ** coords.z
      tile.getContext('2d')?.drawImage(image, coords.x * sourceSize, coords.y * sourceSize,
        sourceSize, sourceSize, 0, 0, size.x, size.y)
      done(undefined, tile)
    }, error => done(error, tile))
    return tile
  }
}

export default function MapLandCover() {
  const map = useMap()
  useEffect(() => {
    const layer = new LandCoverLayer({
      className: 'map-land-cover',
      maxZoom: 4,
      opacity: 0.8,
      zIndex: 2,
    }).addTo(map)
    return () => { layer.remove() }
  }, [map])
  return null
}
