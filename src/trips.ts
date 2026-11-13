import tzLookup from 'tz-lookup'
import type { TimelinePoint } from './timeline.ts'
import { distanceKm } from './timeline.ts'
import { buildRouteSegments } from './routes.ts'
import type { PlaceAnalysis, PlaceEntry } from './places.ts'
import { normalizeHomeRadius, type DatedHomeLocation } from './tripSettings.ts'

export type TripDestination = { key: string; name: string; countryCode?: string; kind: 'city' | 'country' | 'place' | 'itinerary'; locality?: string; region?: string; lat?: number; lng?: number }
export type TripLocalityResolver = (point: Pick<TimelinePoint, 'lat' | 'lng'>, countryCode?: string) => { name: string; countryCode?: string; region?: string; distanceKm?: number } | undefined
export type TimelineTrip = { id: string; destination: TripDestination; category: 'destination' | 'roadtrip' | 'multi-stop'; scope: 'domestic' | 'international' | 'unknown'; hasFlight: boolean; homeKey?: string; homeCountryCode?: string; countryCodes: string[]; startTimestamp: string; endTimestamp: string; startDate: string; endDate: string; nights: number; distanceKm: number; places: TripDestination[]; pointIds: string[]; mapPointIds?: string[] }
export type TripDestinationGroup = { destination: TripDestination; trips: TimelineTrip[]; totalNights: number; totalDistanceKm: number; lastStartDate: string }
export type TripHome = { key: string; name?: string; countryCode?: string; startDate: string; lat: number; lng: number; recordedNights: number; explicit: boolean }
export type TripOptions = { homeRadiusKm?: number; homes?: readonly (DatedHomeLocation & { countryCode?: string })[] }
export type TripsAnalysis = { homeStatus: 'detected' | 'missing'; homeCount: number; homeRadiusKm: number; homes: TripHome[]; trips: TimelineTrip[]; groups: TripDestinationGroup[] }

const HOUR = 3_600_000
const DAY = 24 * HOUR
const HOME_RADIUS_KM = 0.3
const STAY_RADIUS_KM = 1
const MAX_BLIND_GAP = 36 * HOUR
const MAX_HOME_LEG_MS = 6 * HOUR
const MAX_VISIT_EVIDENCE = 90 * DAY
const CELL = HOME_RADIUS_KM / 6371
type Night = { date: string; day: number; at: number; instant: number }
type HomeCluster = { id: number; point: TimelinePoint; nights: Map<string, Night>; explicit: Map<string, number> }
type HomeProfile = { at: number; cluster: HomeCluster; zone: string; recordedNights: number; explicit: boolean; manual?: { countryCode?: string } }
const empty = (homeRadiusKm: number): TripsAnalysis => ({ homeStatus: 'missing', homeCount: 0, homeRadiusKm, homes: [], trips: [], groups: [] })

function homeLabel(point: TimelinePoint): boolean {
  return /^(HOME|HJEM)$/.test(point.label.toUpperCase().replace(/[ _-]/g, ''))
}

/** All calendar operations are local to the recorded location, never the host. */
function calendarTools() {
  const formats = new Map<string, Intl.DateTimeFormat>()
  const zones = new Map<string, string>()
  const zoneAt = (point: TimelinePoint) => {
    const key = `${point.lat}:${point.lng}`
    let zone = zones.get(key)
    if (!zone) {
      try { zone = tzLookup(point.lat, point.lng) } catch { zone = 'UTC' }
      if (zones.size >= 4096) zones.clear()
      zones.set(key, zone)
    }
    return zone
  }
  const local = (time: number, zone: string) => {
    let formatter = formats.get(zone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      formats.set(zone, formatter)
    }
    const parts: Record<string, string> = {}
    for (const part of formatter.formatToParts(time)) if (part.type !== 'literal') parts[part.type] = part.value
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) }
  }
  const localInstant = (date: string, zone: string, hour = 4) => {
    const desired = Date.parse(date) + hour * HOUR
    let time = desired
    for (let iteration = 0; iteration < 3; iteration++) {
      const part = local(time, zone)
      const represented = Date.parse(`${part.date}T00:00:00Z`) + part.hour * HOUR + part.minute * 60_000 + part.second * 1000
      const correction = desired - represented
      time += correction
      if (!correction) break
    }
    return time
  }
  const nightCache = new WeakMap<TimelinePoint, Night[]>()
  const nightsAt = (point: TimelinePoint): Night[] => {
    const cached = nightCache.get(point)
    if (cached) return cached
    const start = Date.parse(point.timestamp)
    const end = point.endTimestamp ? Date.parse(point.endTimestamp) : NaN
    const result: Night[] = []
    if (point.kind === 'visit' && Number.isFinite(start) && Number.isFinite(end) && end - start >= 3 * HOUR && end - start <= MAX_VISIT_EVIDENCE) {
      const zone = zoneAt(point)
      const first = Date.parse(`${local(start, zone).date}T00:00:00Z`)
      const last = Date.parse(`${local(end - 1, zone).date}T00:00:00Z`)
      for (let day = first; day <= last && day <= first + 91 * DAY; day += DAY) {
        const date = new Date(day).toISOString().slice(0, 10)
        const at = localInstant(date, zone)
        if (at >= start && at < end) result.push({ date, day, at: start, instant: at })
      }
    }
    nightCache.set(point, result)
    return result
  }
  return { zoneAt, local, nightsAt, localInstant }
}

function clusterIndex() {
  const cells = new Map<string, HomeCluster[]>()
  const clusters: HomeCluster[] = []
  const find = (point: TimelinePoint) => {
    const lat = point.lat * Math.PI / 180
    const lng = point.lng * Math.PI / 180
    const [x, y, z] = [Math.floor(Math.cos(lat) * Math.cos(lng) / CELL), Math.floor(Math.cos(lat) * Math.sin(lng) / CELL), Math.floor(Math.sin(lat) / CELL)]
    let best: HomeCluster | undefined
    let nearest = HOME_RADIUS_KM
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const candidate of cells.get(`${x! + dx}:${y! + dy}:${z! + dz}`) ?? []) {
        const distance = distanceKm([point, candidate.point])
        if (distance <= nearest) { best = candidate; nearest = distance }
      }
    }
    if (best) return best
    const cluster = { id: clusters.length, point, nights: new Map(), explicit: new Map() }
    clusters.push(cluster)
    const key = `${x}:${y}:${z}`
    const list = cells.get(key) ?? []
    list.push(cluster)
    cells.set(key, list)
    return cluster
  }
  return { clusters, find }
}

type StayCluster = { point: TimelinePoint; namedPoint?: TimelinePoint; destination?: TripDestination }

/** Fixed anchors prevent single-link chains from merging neighbouring stays.
 * Indexing the complete import first keeps identities stable across filters. */
function createStayIndex(radiusKm: number) {
  const cells = new Map<string, StayCluster[]>()
  const byPoint = new WeakMap<TimelinePoint, StayCluster>()
  const clusters: StayCluster[] = []
  const cell = radiusKm / 6371
  const find = (point: TimelinePoint): StayCluster => {
    const cached = byPoint.get(point)
    if (cached) return cached
    const lat = point.lat * Math.PI / 180
    const lng = point.lng * Math.PI / 180
    const x = Math.floor(Math.cos(lat) * Math.cos(lng) / cell)
    const y = Math.floor(Math.cos(lat) * Math.sin(lng) / cell)
    const z = Math.floor(Math.sin(lat) / cell)
    let best: StayCluster | undefined
    let nearest = radiusKm
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const cluster of cells.get(`${x + dx}:${y + dy}:${z + dz}`) ?? []) {
        const distance = distanceKm([point, cluster.point])
        if (distance <= nearest) { nearest = distance; best = cluster }
      }
    }
    if (!best) {
      best = { point }
      clusters.push(best)
      const key = `${x}:${y}:${z}`
      const list = cells.get(key) ?? []
      list.push(best)
      cells.set(key, list)
    }
    byPoint.set(point, best)
    return best
  }
  return { find, clusters }
}

function stayClusterIndex(points: TimelinePoint[], allPoints: TimelinePoint[], calendar: ReturnType<typeof calendarTools>) {
  const semantic = createStayIndex(STAY_RADIUS_KM)
  const meaningfulLabel = (label: string) => !/^(HOME|HJEM|WORK|INFERREDHOME|INFERREDWORK|ALIASEDLOCATION|SEARCHEDADDRESS|SEARCHADDRESS|UNKNOWN|BESØKTSTED|VISITEDPLACE|RUTEPUNKT|HOTEL|AIRPORT|PORT|DESTINATION)$/.test(label.trim().toUpperCase().replace(/[ _-]/g, ''))
  const visits = points.filter(point => {
    if (point.kind !== 'visit' || !point.endTimestamp) return false
    const duration = Date.parse(point.endTimestamp) - Date.parse(point.timestamp)
    if (!(duration >= 30 * 60_000 && duration <= MAX_VISIT_EVIDENCE)) return false
    const cluster = semantic.find(point)
    // A short café stop next door must not name an overnight accommodation.
    if (duration >= 3 * HOUR && meaningfulLabel(point.label)) {
      const previousDuration = cluster.namedPoint ? Date.parse(cluster.namedPoint.endTimestamp!) - Date.parse(cluster.namedPoint.timestamp) : 0
      if (duration > previousDuration) cluster.namedPoint = point
    }
    return true
  })
  const observations = allPoints.filter(point => point.source === 'timelinePath' || point.source === 'raw').map(point => ({ point, time: Date.parse(point.timestamp) }))
  const firstObservation = (time: number) => {
    let left = 0
    let right = observations.length
    while (left < right) { const middle = (left + right) >>> 1; if (observations[middle]!.time < time) left = middle + 1; else right = middle }
    return left
  }
  type Evidence = { index: ReturnType<typeof createStayIndex>; observed: WeakSet<TimelinePoint>; clouds: Map<StayCluster, { nights: Set<string>; count: number }> }
  const measured = new Map<StayCluster, Evidence>()
  for (const visit of visits) {
    const start = Date.parse(visit.timestamp)
    const end = Date.parse(visit.endTimestamp!)
    if (end - start < 3 * HOUR) continue
    const cluster = semantic.find(visit)
    const zone = calendar.zoneAt(cluster.point)
    for (let index = firstObservation(start); index < observations.length && observations[index]!.time < end; index++) {
      const { point, time } = observations[index]!
      if (distanceKm([point, visit]) > 5) continue
      const local = calendar.local(time, zone)
      if (local.hour >= 7 && local.hour < 22) continue
      const evidence = measured.get(cluster) ?? { index: createStayIndex(0.1), observed: new WeakSet(), clouds: new Map() }
      measured.set(cluster, evidence)
      if (evidence.observed.has(point)) continue
      evidence.observed.add(point)
      const cloud = evidence.index.find(point)
      const support = evidence.clouds.get(cloud) ?? { nights: new Set(), count: 0 }
      // Evening and following morning belong to one night, not two samples
      // of independent overnight evidence.
      const night = local.hour >= 22 ? new Date(Date.parse(`${local.date}T00:00:00Z`) + DAY).toISOString().slice(0, 10) : local.date
      support.nights.add(night)
      support.count++
      evidence.clouds.set(cloud, support)
    }
  }
  const final = createStayIndex(STAY_RADIUS_KM)
  const merged = new Map<StayCluster, StayCluster>()
  for (const cluster of semantic.clusters) {
    const evidence = measured.get(cluster)
    const ranked = [...(evidence?.clouds.entries() ?? [])].sort((a, b) => b[1].nights.size - a[1].nights.size || b[1].count - a[1].count)
    const best = ranked[0]
    const runnerUpNights = ranked[1]?.[1].nights.size ?? 0
    // Correct stale semantic anchors only with a recurring measured night
    // position. An isolated fix, one night's dense trace, or competing bases
    // cannot move a destination. The original TimelinePoints remain untouched.
    const representative = best && best[1].count >= 3 && best[1].nights.size >= 2 && best[1].nights.size >= runnerUpNights * 2 ? best[0].point : cluster.point
    const target = final.find(representative)
    if (cluster.namedPoint) {
      const previousDuration = target.namedPoint ? Date.parse(target.namedPoint.endTimestamp!) - Date.parse(target.namedPoint.timestamp) : 0
      const duration = Date.parse(cluster.namedPoint.endTimestamp!) - Date.parse(cluster.namedPoint.timestamp)
      if (duration > previousDuration) target.namedPoint = cluster.namedPoint
    }
    merged.set(cluster, target)
  }
  const byPoint = new WeakMap(visits.map(point => [point, merged.get(semantic.find(point))!] as const))
  return { find: (point: TimelinePoint) => byPoint.get(point) ?? final.find(point) }
}

function lowerBound(values: Night[], day: number): number {
  let left = 0
  let right = values.length
  while (left < right) { const middle = (left + right) >>> 1; if (values[middle]!.day < day) left = middle + 1; else right = middle }
  return left
}

function homeProfiles(points: TimelinePoint[], calendar: ReturnType<typeof calendarTools>): HomeProfile[] {
  const index = clusterIndex()
  for (const point of points) {
    const nights = calendar.nightsAt(point)
    const explicit = point.kind === 'visit' && homeLabel(point)
    if (!nights.length && !explicit) continue
    const cluster = index.find(point)
    for (const night of nights) if (!cluster.nights.has(night.date)) cluster.nights.set(night.date, night)
    if (explicit) {
      const time = Date.parse(point.timestamp)
      if (Number.isFinite(time)) cluster.explicit.set(calendar.local(time, calendar.zoneAt(point)).date, time)
    }
  }
  const nightLists = new Map(index.clusters.map(cluster => [cluster.id, [...cluster.nights.values()].sort((a, b) => a.day - b.day)]))
  const count = (cluster: HomeCluster, from: number, to: number) => {
    const list = nightLists.get(cluster.id)!
    return lowerBound(list, to) - lowerBound(list, from)
  }
  type Candidate = { at: number; day: number; cluster: HomeCluster; explicit: boolean; support: number }
  const candidates: Candidate[] = []
  const recurring = index.clusters.filter(cluster => cluster.nights.size >= 30)
  for (const cluster of recurring) {
    const nights = nightLists.get(cluster.id)!
    for (let start = 0; start < nights.length; start++) {
      const first = nights[start]!
      const end = lowerBound(nights, first.day + 60 * DAY)
      const support = end - start
      if (support < 30 || nights[end - 1]!.day - first.day < 29 * DAY) continue
      // A hotel holiday is not a move: inferred homes must also recur well
      // after their initial month. Explicit repeated Home records can supply
      // the stronger evidence for a short history.
      if (cluster.explicit.size < 2 && count(cluster, first.day + 60 * DAY, first.day + 180 * DAY) < 3) continue
      candidates.push({ at: first.at, day: first.day, cluster, explicit: false, support })
    }
  }
  for (const cluster of index.clusters) {
    const events = [...cluster.explicit.entries()].sort((a, b) => a[1] - b[1])
    if (events.length >= 2) {
      const [date, at] = events[0]!
      candidates.push({ at, day: Date.parse(`${date}T00:00:00Z`), cluster, explicit: true, support: events.length })
    }
  }
  candidates.sort((a, b) => a.at - b.at || Number(b.explicit) - Number(a.explicit) || b.support - a.support)
  const profiles: HomeProfile[] = []
  for (const candidate of candidates) {
    const current = profiles.at(-1)?.cluster
    if (current === candidate.cluster) continue
    if (!candidate.explicit) {
      const currentCount = current ? count(current, candidate.day, candidate.day + 60 * DAY) : 0
      if (currentCount > 0 && candidate.support < currentCount * 2) continue
      if (recurring.some(other => other !== candidate.cluster && count(other, candidate.day, candidate.day + 60 * DAY) > candidate.support)) continue
      if (current) {
        const formerReturns = count(current, candidate.day + 60 * DAY, candidate.day + 240 * DAY)
        const candidateContinues = count(candidate.cluster, candidate.day + 60 * DAY, candidate.day + 240 * DAY)
        if (formerReturns >= 14 && formerReturns >= candidateContinues * 2) continue
      }
    } else if (current) {
      const futureCurrent = [...current.explicit.values()].filter(time => time >= candidate.at && time < candidate.at + 30 * DAY).length
      if (futureCurrent >= 2 || count(current, candidate.day, candidate.day + 60 * DAY) > count(candidate.cluster, candidate.day, candidate.day + 60 * DAY)) continue
    }
    profiles.push({ at: candidate.at, cluster: candidate.cluster, zone: calendar.zoneAt(candidate.cluster.point), recordedNights: count(candidate.cluster, candidate.day, candidate.day + 60 * DAY), explicit: candidate.explicit })
  }
  return profiles
}

/** Closed home-to-home trips only. A night is a local-home calendar boundary,
 * so Friday–Sunday is two nights even during DST or on an overnight flight.
 * Recorded intervals support their own duration; a >36h blind gap rejects the
 * candidate rather than converting missing history into a holiday. A bounded
 * exception joins observations within 100km in the same foreign country, up
 * to seven days apart and both at least 100km from home; the map still retains
 * its normal recording gaps. */
export function buildTrips(points: TimelinePoint[], allPoints: TimelinePoint[], places: PlaceAnalysis, resolveLocality?: TripLocalityResolver, options: TripOptions = {}): TripsAnalysis {
  const homeRadiusKm = normalizeHomeRadius(options.homeRadiusKm)
  const calendar = calendarTools()
  const first = points[0]
  const manualProfiles: HomeProfile[] = first ? (options.homes ?? []).map(home => {
    const point: TimelinePoint = { lat: home.lat, lng: home.lng, id: '', timestamp: first.timestamp, kind: 'visit', label: '' }
    const zone = calendar.zoneAt(point)
    return {
      at: home.from ? calendar.localInstant(home.from, zone, 0) : -Infinity,
      cluster: { id: 0, point, nights: new Map(), explicit: new Map() },
      zone,
      recordedNights: 0,
      explicit: true,
      manual: { countryCode: home.countryCode },
    }
  }).filter(home => home.at <= Date.parse(points.at(-1)!.timestamp)).sort((a, b) => a.at - b.at) : []
  const manualStart = manualProfiles[0]?.at ?? Infinity
  const profiles = manualStart <= Date.parse(first?.timestamp ?? '') ? manualProfiles
    : [...homeProfiles(points, calendar).filter(home => home.at < manualStart), ...manualProfiles]
  if (!profiles.length) return empty(homeRadiusKm)
  const cityForPoint = new Map<string, PlaceEntry>()
  const countryForPoint = new Map<string, PlaceEntry>()
  for (const city of places.cities) for (const id of city.pointIds) cityForPoint.set(id, city)
  for (const country of places.countries) for (const id of country.pointIds) countryForPoint.set(id, country)
  const countryAt = (point: TimelinePoint) => countryForPoint.get(point.id)?.countryCode ?? cityForPoint.get(point.id)?.countryCode
  const homes: TripHome[] = profiles.map(home => {
    const point = home.cluster.point
    const countryCode = home.manual ? home.manual.countryCode : countryAt(point)
    const local = resolveLocality?.(point, countryCode)
    return { key: `home:${point.lat.toFixed(5)}:${point.lng.toFixed(5)}`, name: local?.name ?? cityForPoint.get(point.id)?.name, countryCode: home.manual ? countryCode : countryCode ?? local?.countryCode,
      startDate: calendar.local(home.at === -Infinity ? Date.parse(first!.timestamp) : home.at, home.zone).date, lat: point.lat, lng: point.lng, recordedNights: home.recordedNights, explicit: home.explicit }
  })
  const homeCountry = new Map(profiles.map((home, index) => [home, homes[index]!.countryCode]))
  const homeKeys = new Map(profiles.map((home, index) => [home, homes[index]!.key]))
  let stayHomeIndex = -1
  const awayVisits = allPoints.filter(point => {
    if (point.kind !== 'visit') return false
    const time = Date.parse(point.timestamp)
    while (stayHomeIndex + 1 < profiles.length && profiles[stayHomeIndex + 1]!.at <= time) stayHomeIndex++
    const home = profiles[stayHomeIndex]
    // Do not let a home anchor swallow a legitimate nearby overnight stay.
    return !home || distanceKm([point, home.cluster.point]) > homeRadiusKm
  })
  const stayIndex = stayClusterIndex(awayVisits, allPoints, calendar)
  const destinationAt = (point: TimelinePoint): TripDestination => {
    const cluster = stayIndex.find(point)
    if (cluster.destination) return cluster.destination
    const anchor = cluster.point
    const city = cityForPoint.get(anchor.id) ?? cityForPoint.get(point.id)
    const country = countryForPoint.get(anchor.id) ?? countryForPoint.get(point.id)
    const countryCode = country?.countryCode ?? city?.countryCode
    const local = resolveLocality?.(anchor, countryCode)
    const locality = local?.name ?? city?.name
    cluster.destination = { key: `stay:${anchor.lat.toFixed(5)}:${anchor.lng.toFixed(5)}`, name: cluster.namedPoint?.label ?? locality ?? `${anchor.lat.toFixed(3)}, ${anchor.lng.toFixed(3)}`,
      countryCode: countryCode ?? local?.countryCode, locality, region: local?.region, lat: anchor.lat, lng: anchor.lng, kind: 'place' }
    return cluster.destination
  }
  const cityDestinations = new Map<string, TripDestination>()
  const internationalDestinationAt = (point: TimelinePoint): TripDestination => {
    const city = cityForPoint.get(point.id)
    const country = countryForPoint.get(point.id)
    const code = country?.countryCode ?? city?.countryCode
    const key = city ? `city:${city.key}` : code ? `country:${code}` : undefined
    if (!key) return destinationAt(point)
    let destination = cityDestinations.get(key)
    if (!destination) {
      destination = { key, name: city?.name ?? country?.name ?? code!, countryCode: code, kind: city ? 'city' : 'country', lat: point.lat, lng: point.lng }
      cityDestinations.set(key, destination)
    }
    return destination
  }
  const visitEvidenceEnd = (point: TimelinePoint, time: number) => {
    let end = time
    if (point.kind === 'visit' && point.endTimestamp) {
      const visitEnd = Date.parse(point.endTimestamp)
      if (visitEnd >= time && visitEnd - time <= MAX_VISIT_EVIDENCE) end = Math.max(end, visitEnd)
    }
    return end
  }
  const evidenceEnd = (point: TimelinePoint, time: number) => {
    let end = visitEvidenceEnd(point, time)
    for (const activity of point.activities ?? []) {
      const start = Date.parse(activity.startTimestamp)
      const finish = Date.parse(activity.endTimestamp)
      if (start <= time && finish >= time && finish - start <= 36 * HOUR) end = Math.max(end, finish)
    }
    return end
  }
  type HomeAnchor = { index: number; time: number; end: number }
  type CandidateTrip = { start: HomeAnchor; departure: number; coveredUntil: number; lastPoint: TimelinePoint; requiredOvernightCountries: Set<string>; invalid: boolean; home: HomeProfile }
  const trips: TimelineTrip[] = []
  const featuredStays = new Map<string, TripDestination>()
  const itineraryStops = new Map<TimelineTrip, TripDestination[]>()
  let profileIndex = -1
  let lastHome: HomeAnchor | undefined
  let candidate: CandidateTrip | undefined

  // Extend the display only when the same inside-area leg has a recorded
  // observation near this home's center. Stop at other trips or home profiles.
  const findMapHomeAnchor = (boundary: HomeAnchor, direction: -1 | 1, home: HomeProfile) => {
    const nextHomeAt = profiles[profileIndex + 1]?.at ?? Infinity
    for (let index = boundary.index; index >= 0 && index < points.length; index += direction) {
      const point = points[index]!
      const time = Date.parse(point.timestamp)
      if (!Number.isFinite(time) || time < home.at || time >= nextHomeAt) break
      const elapsed = direction === -1 ? boundary.time - visitEvidenceEnd(point, time) : time - boundary.time
      if (elapsed > MAX_HOME_LEG_MS) break
      const distance = distanceKm([point, home.cluster.point])
      if (distance > homeRadiusKm) break
      if (distance <= HOME_RADIUS_KM) return index
    }
    return boundary.index
  }

  const complete = (trip: CandidateTrip, arrival: HomeAnchor) => {
    if (trip.invalid || arrival.time <= trip.departure) return
    const startDate = calendar.local(trip.departure, trip.home.zone).date
    const endDate = calendar.local(arrival.time, trip.home.zone).date
    const nights = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY)
    if (nights < 2) return
    // The visit anchor can precede departure by a night. Retain that original
    // home coordinate, but not earlier drift/errands covered by its home stay.
    const selected = [points[trip.start.index]!, ...points.slice(trip.start.index + 1, arrival.index + 1).filter(point => Date.parse(point.timestamp) >= trip.departure)]
    const stays = selected.filter(point => {
      if (distanceKm([point, trip.home.cluster.point]) <= homeRadiusKm || point.kind !== 'visit' || !point.endTimestamp) return false
      const start = Math.max(Date.parse(point.timestamp), trip.departure)
      const end = Math.min(Date.parse(point.endTimestamp), arrival.time)
      return Number.isFinite(start) && Number.isFinite(end) && end - start >= 30 * 60_000 && end - start <= MAX_VISIT_EVIDENCE
    })
    const dwells: { point: TimelinePoint; start: number; end: number }[] = []
    if (!stays.length) {
      for (let index = 1; index < selected.length - 1; index++) {
        const point = selected[index]!
        const next = selected[index + 1]!
        const start = Date.parse(point.timestamp)
        const end = Date.parse(next.timestamp)
        if (end - start >= HOUR && end - start <= 24 * HOUR && distanceKm([point, next]) <= 5 && distanceKm([point, trip.home.cluster.point]) > homeRadiusKm) dwells.push({ point, start, end })
      }
    }
    // Classification uses recorded stays, not countries crossed in flight.
    const visited = stays.length ? stays : dwells.map(dwell => dwell.point)
    const codes = new Set(visited.map(countryAt).filter((code): code is string => Boolean(code)))
    const homeCountryCode = homeCountry.get(trip.home)
    const hasUnknownStay = visited.some(point => !countryAt(point))
    const scope: TimelineTrip['scope'] = !homeCountryCode ? 'unknown' : [...codes].some(code => code !== homeCountryCode) ? 'international' : codes.size && !hasUnknownStay ? 'domestic' : 'unknown'
    const tripDestinationAt = scope === 'international' ? internationalDestinationAt : destinationAt
    const countryCodes = [...new Set([...(homeCountryCode ? [homeCountryCode] : []), ...codes])]
    const route = buildRouteSegments(selected, allPoints)
    const activities = new Map((selected.flatMap(point => point.activities ?? [])).map(activity => [activity.id, activity]))
    const travelStart = Math.max(trip.start.time, trip.start.end)
    const hasFlight = route.segments.some(segment => segment.transport === 'flight') || [...activities.values()].some(activity => activity.mode === 'flight'
      && Date.parse(activity.endTimestamp) > Date.parse(activity.startTimestamp)
      && Date.parse(activity.startTimestamp) < arrival.time && Date.parse(activity.endTimestamp) > travelStart)
    type Score = { destination: TripDestination; point: TimelinePoint; nights: Set<string>; intervals: [number, number][]; first: number; nearHome: boolean }
    const scores = new Map<string, Score>()
    const overnightCountries = new Set<string>()
    for (const point of stays) {
      const start = Math.max(Date.parse(point.timestamp), trip.departure)
      const end = Math.min(Date.parse(point.endTimestamp!), arrival.time)
      const destination = tripDestinationAt(point)
      const score = scores.get(destination.key) ?? { destination, point, nights: new Set(), intervals: [], first: start, nearHome: true }
      score.nearHome &&= distanceKm([point, trip.home.cluster.point]) <= 50
      for (const night of calendar.nightsAt(point)) {
        if (night.instant >= trip.departure && night.instant < arrival.time) {
          score.nights.add(night.date)
          const code = countryForPoint.get(point.id)?.countryCode
          if (code) overnightCountries.add(code)
        }
      }
      score.intervals.push([start, end])
      scores.set(destination.key, score)
    }
    // Matching foreign observations alone could be separate day trips. Sparse
    // continuity also needs a recorded overnight stay in that country.
    if ([...trip.requiredOvernightCountries].some(code => !overnightCountries.has(code))) return
    // Sparse files can still contain a confirmed home-to-home journey. Use its
    // longest observed away dwell as a fallback, rather than point density.
    if (!scores.size) {
      for (const { point, start, end } of dwells) {
        const destination = tripDestinationAt(point)
        const score = scores.get(destination.key) ?? { destination, point, nights: new Set(), intervals: [], first: start, nearHome: true }
        score.nearHome &&= distanceKm([point, trip.home.cluster.point]) <= 50
        score.intervals.push([start, end])
        scores.set(destination.key, score)
      }
    }
    if (!scores.size) return
    const duration = (intervals: [number, number][]) => {
      intervals.sort((a, b) => a[0] - b[0])
      let total = 0
      let until = -Infinity
      for (const [start, end] of intervals) { total += Math.max(0, end - Math.max(start, until)); until = Math.max(until, end) }
      return total
    }
    const ordered = [...scores.values()].map(score => ({ ...score, duration: duration(score.intervals) })).sort((a, b) => b.nights.size - a.nights.size || b.duration - a.duration || a.first - b.first || a.destination.key.localeCompare(b.destination.key))
    // Nearby departure ports and airport stops must not outrank the away
    // destination of a cruise. Nearby stays with actual nights still qualify.
    const eligible = ordered.filter(score => score.nights.size > 0 || !score.nearHome)
    const primary = eligible[0] ?? ordered[0]!
    const overnight = eligible.filter(score => score.nights.size > 0)
    const totalNights = overnight.reduce((total, score) => total + score.nights.size, 0)
    // One dominant base can have side trips. Comparable overnight bases form
    // an itinerary instead of being attributed arbitrarily to the first city.
    const hasDominantBase = overnight.length < 2 || primary.nights.size * 3 >= totalNights * 2
    const dayStops = eligible.filter(score => score.duration >= 2 * HOUR)
    const totalDwell = dayStops.reduce((total, score) => total + score.duration, 0)
    const dispersedDayStops = !overnight.length && dayStops.length >= 2 && primary.duration * 3 < totalDwell * 2
      && dayStops.some(score => distanceKm([primary.point, score.point]) >= 20)
    const multipleStops = !hasDominantBase || dispersedDayStops
    const stops = (overnight.length ? overnight : dayStops).sort((a, b) => a.first - b.first)
    let category: TimelineTrip['category'] = 'destination'
    let destination = primary.destination
    if (multipleStops) {
      let connectingDistance = 0
      let roadDistance = 0
      let connectingFlight = false
      for (let index = 1; index < stops.length; index++) {
        const from = stops[index - 1]!
        const to = stops[index]!
        const direct = distanceKm([from.point, to.point])
        if (direct < 20) continue
        connectingDistance += direct
        const departure = Math.max(from.first, ...from.intervals.filter(interval => interval[1] <= to.first).map(interval => interval[1]))
        let observedRoad = 0
        let roadTime = 0
        for (const activity of activities.values()) {
          const start = Date.parse(activity.startTimestamp)
          const end = Date.parse(activity.endTimestamp)
          if (start < departure - 30 * 60_000 || end > to.first + 30 * 60_000 || end <= start) continue
          if (activity.mode === 'flight') connectingFlight = true
          if (activity.mode === 'road') { observedRoad += Math.max(0, activity.distanceKm); roadTime += end - start }
        }
        if (observedRoad >= direct * 0.5 || (observedRoad === 0 && roadTime >= HOUR)) roadDistance += direct
      }
      category = !hasFlight && !connectingFlight && connectingDistance >= 20 && roadDistance >= connectingDistance * 0.6 ? 'roadtrip' : 'multi-stop'
      destination = { key: `itinerary:${JSON.stringify([category, stops.map(score => score.destination.key)])}`, name: '', kind: 'itinerary' }
      for (const score of stops) featuredStays.set(score.destination.key, score.destination)
    } else featuredStays.set(destination.key, destination)
    const result: TimelineTrip = { id: `${points[trip.start.index]!.id}:${points[arrival.index]!.id}`, destination, category, scope, hasFlight, homeKey: homeKeys.get(trip.home), homeCountryCode, countryCodes,
      startTimestamp: new Date(trip.departure).toISOString(), endTimestamp: new Date(arrival.time).toISOString(), startDate, endDate, nights,
      // Disjoint trip slices reuse the route module's immutable source index.
      // Total work is linear in trip observations, not one full import per trip.
      distanceKm: route.distanceKm,
      places: [...ordered].sort((a, b) => a.first - b.first).map(score => score.destination), pointIds: selected.map(point => point.id) }
    const mapStart = trip.start.time >= trip.start.end ? findMapHomeAnchor(trip.start, -1, trip.home) : trip.start.index
    const mapEnd = findMapHomeAnchor(arrival, 1, trip.home)
    if (mapStart < trip.start.index || mapEnd > arrival.index) {
      const first = points[mapStart]!
      const firstEnd = visitEvidenceEnd(first, Date.parse(first.timestamp))
      const outbound = points.slice(mapStart, trip.start.index).filter((point, index) => index === 0 || Date.parse(point.timestamp) >= firstEnd)
      result.mapPointIds = [...outbound, ...selected, ...points.slice(arrival.index + 1, mapEnd + 1)].map(point => point.id)
    }
    trips.push(result)
    if (multipleStops) itineraryStops.set(result, stops.map(score => score.destination))
  }

  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    const time = Date.parse(point.timestamp)
    if (!Number.isFinite(time)) {
      if (candidate) candidate.invalid = true
      continue
    }
    let changed = false
    while (profileIndex + 1 < profiles.length && profiles[profileIndex + 1]!.at <= time) { profileIndex++; changed = true }
    if (changed) { lastHome = undefined; candidate = undefined }
    if (profileIndex < 0) continue
    const home = profiles[profileIndex]!
    if (candidate) {
      if (time - candidate.coveredUntil > MAX_BLIND_GAP) {
        const previous = candidate.lastPoint
        const country = countryForPoint.get(point.id)?.countryCode
        const previousCountry = countryForPoint.get(previous.id)?.countryCode
        const homeCode = homeCountry.get(home)
        const sameAwayRegion = country && homeCode && country !== homeCode && country === previousCountry
          && time - candidate.coveredUntil <= 7 * DAY
          && distanceKm([previous, point]) <= 100
          && distanceKm([previous, home.cluster.point]) >= 100
          && distanceKm([point, home.cluster.point]) >= 100
        if (!sameAwayRegion) candidate.invalid = true
        else candidate.requiredOvernightCountries.add(country)
      }
      candidate.coveredUntil = Math.max(candidate.coveredUntil, evidenceEnd(point, time))
      candidate.lastPoint = point
    }
    const atHome = distanceKm([point, home.cluster.point]) <= homeRadiusKm
    if (atHome) {
      const end = visitEvidenceEnd(point, time)
      // Every valid inside-area observation is a boundary, including a brief
      // pass through. A trip may never contain it as an interior observation.
      if (candidate) complete(candidate, { index, time, end })
      candidate = undefined
      lastHome = { index, time, end: Math.max(end, lastHome?.end ?? -Infinity) }
    } else {
      if (!candidate && lastHome) {
        // Path drift cannot create a holiday during a known home visit.
        if (time < lastHome.end) continue
        // Unknown time after the last inside fix is not evidence of a night
        // outside the radius. Begin at the first recorded outside observation.
        const departure = time
        candidate = { start: lastHome, departure, coveredUntil: evidenceEnd(point, time), lastPoint: point, requiredOvernightCountries: new Set(), invalid: time - Math.max(lastHome.time, lastHome.end) > MAX_BLIND_GAP, home }
      }
    }
  }
  trips.sort((a, b) => b.startTimestamp.localeCompare(a.startTimestamp))
  // Different stays can share the nearest village or a generic venue name.
  // Keep their visible titles distinguishable without inventing a cabin name.
  const ambiguous = new Map<string, TripDestination[]>()
  for (const destination of featuredStays.values()) {
    const key = JSON.stringify([destination.name, destination.locality, destination.region, destination.countryCode])
    const list = ambiguous.get(key) ?? []
    list.push(destination)
    ambiguous.set(key, list)
  }
  for (const list of ambiguous.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.key.localeCompare(b.key))
    list.forEach((destination, index) => { destination.name += ` · ${index + 1}` })
  }
  for (const [trip, stops] of itineraryStops) trip.destination.name = stops.map(stop => stop.name).filter((name, index, names) => index === 0 || name !== names[index - 1]).join(' → ')
  const groups = new Map<string, TripDestinationGroup>()
  for (const trip of trips) {
    const group = groups.get(trip.destination.key) ?? { destination: trip.destination, trips: [], totalNights: 0, totalDistanceKm: 0, lastStartDate: trip.startDate }
    group.trips.push(trip)
    group.totalNights += trip.nights
    group.totalDistanceKm += trip.distanceKm
    groups.set(trip.destination.key, group)
  }
  return { homeStatus: 'detected', homeCount: new Set(profiles.map(profile => profile.cluster.id)).size, homeRadiusKm, homes, trips, groups: [...groups.values()] }
}
