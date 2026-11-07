type JsonRecord = Record<string, unknown>

export type MergeSummary = {
  inputRecords: number
  outputRecords: number
  duplicatesRemoved: number
  conflicts: number
}

export class TimelineMergeError extends Error {
  readonly code = 'unsupportedFormat'

  constructor() {
    super('Choose a supported Google Timeline JSON export.')
    this.name = 'TimelineMergeError'
  }
}

const collections = ['semanticSegments', 'rawSignals', 'timelineObjects', 'locations'] as const
const recordArrays = new Set<string>([...collections, 'timelinePath', 'points'])
const timeFields = new Set(['startTime', 'endTime', 'timestamp', 'time', 'startTimestamp', 'endTimestamp'])
const numberFields = new Set(['latitudeE7', 'longitudeE7', 'latE7', 'lngE7', 'durationMinutesOffsetFromStartTime', 'timestampMs', 'startTimestampMs', 'endTimestampMs'])
const noMerge = Symbol('conflicting values')

function mergeableArray(key: string, values: unknown[]): boolean {
  if (!recordArrays.has(key)) return false
  if (key !== 'points') return true
  return values.every(value => coordinate(value) !== undefined && recordTime(value) !== undefined)
}

function object(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function empty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  const record = object(value)
  return record !== undefined && Object.keys(record).length === 0
}

function instant(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]!) return undefined
  const result = Date.parse(text)
  return Number.isFinite(result) ? result : undefined
}

function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return undefined
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}

function coordinate(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(?:geo:\s*)?([+-]?\d+(?:\.\d+)?)\s*°?\s*,\s*([+-]?\d+(?:\.\d+)?)\s*°?$/i)
    return match ? `${Number(match[1])},${Number(match[2])}` : undefined
  }
  const record = object(value)
  if (!record) return undefined
  const text = record.latLng ?? record.LatLng
  if (typeof text === 'string') return coordinate(text)
  const lat = numeric(record.latitudeE7 ?? record.latE7)
  const lng = numeric(record.longitudeE7 ?? record.lngE7)
  return lat === undefined || lng === undefined ? undefined : `${lat / 1e7},${lng / 1e7}`
}

function scalar(value: unknown, key: string): unknown {
  if (timeFields.has(key)) return instant(value) ?? value
  if (numberFields.has(key)) return numeric(value) ?? value
  if (key === 'point' || key === 'latLng' || key === 'LatLng') return coordinate(value) ?? value
  return value
}

function recordTime(value: unknown, pathStart?: number): number | undefined {
  const record = object(value)
  if (!record) return undefined
  const semantic = object(record.placeVisit) ?? object(record.activitySegment)
  const duration = object(semantic?.duration)
  const position = object(record.position)
  const offset = numeric(record.durationMinutesOffsetFromStartTime)
  return instant(record.startTime) ?? instant(duration?.startTimestamp) ?? numeric(duration?.startTimestampMs)
    ?? instant(record.time) ?? instant(record.timestamp) ?? numeric(record.timestampMs)
    ?? instant(position?.timestamp) ?? numeric(position?.timestampMs)
    ?? (offset === undefined ? undefined : pathStart === undefined ? offset : pathStart + offset * 60_000)
}

function identity(value: unknown, pathStart?: number): string | undefined {
  const record = object(value)
  const time = recordTime(value, pathStart)
  if (!record || time === undefined) return undefined
  if ('placeVisit' in record) return `visit:${time}`
  if ('activitySegment' in record) return `activity:${time}`
  if ('startTime' in record) return `segment:${time}`
  const position = object(record.position)
  const location = coordinate(position ?? record.point ?? record)
  return `${position ? 'position' : 'point'}:${time}:${location ?? 'missing'}`
}

function identityKeys(value: unknown, pathStart?: number): string[] {
  const primary = identity(value, pathStart)
  if (primary) return [primary]
  const path = object(value)?.timelinePath
  if (!Array.isArray(path) || !path.length) return []
  // Without a parent start time, only absolute-time samples identify overlap.
  // Relative offsets from separate envelopes must never be combined this way.
  if (!path.every(point => instant(object(point)?.time) !== undefined || instant(object(point)?.timestamp) !== undefined)) return []
  return path.flatMap(point => {
    const key = identity(point)
    return key ? [`absolute-path:${key}`] : []
  })
}

function sampleInfo(value: unknown, pathStart?: number): { group: string; location?: string } | undefined {
  const primary = identity(value, pathStart)
  if (!primary || !/^(point|position):/.test(primary)) return undefined
  const record = object(value)!
  const position = object(record.position)
  return {
    group: `${position ? 'position' : 'point'}:${recordTime(value, pathStart)}`,
    location: coordinate(position ?? record.point ?? record),
  }
}

function isTimelineRecord(value: unknown): boolean {
  const record = object(value)
  if (!record) return false
  return 'timelinePath' in record || 'visit' in record || 'activitySegment' in record || 'placeVisit' in record
    || ('activity' in record && 'startTime' in record) || 'position' in record
    || (('timestamp' in record || 'timestampMs' in record) && ('latitudeE7' in record || 'latE7' in record || 'LatLng' in record || 'latLng' in record))
}

type Source = { arrays: Map<string, unknown[]>; metadata: JsonRecord[]; bare: boolean }

function source(input: unknown): Source {
  if (Array.isArray(input)) {
    if (input.length && !input.some(isTimelineRecord)) throw new TimelineMergeError()
    return { arrays: new Map([['semanticSegments', input]]), metadata: [], bare: true }
  }
  const record = object(input)
  if (!record) throw new TimelineMergeError()
  const arrays = new Map<string, unknown[]>()
  for (const key of collections) {
    if (Array.isArray(record[key])) arrays.set(key, record[key])
    else if (!empty(record[key])) throw new TimelineMergeError()
  }
  if (!arrays.size) {
    if (isTimelineRecord(record)) return { arrays: new Map([['semanticSegments', [record]]]), metadata: [], bare: true }
    throw new TimelineMergeError()
  }
  const metadata = Object.fromEntries(Object.entries(record).filter(([key]) => !arrays.has(key)))
  const previous = object(metadata.timelineExplorerMerge)
  if (previous?.version === 1 && Array.isArray(previous.sourceMetadata)
    && Object.keys(previous).every(key => key === 'version' || key === 'sourceMetadata')
    && previous.sourceMetadata.every(value => object(value) !== undefined)) {
    delete metadata.timelineExplorerMerge
    return { arrays, metadata: [...previous.sourceMetadata.filter(value => object(value) !== undefined) as JsonRecord[], metadata], bare: false }
  }
  return { arrays, metadata: [metadata], bare: false }
}

/** Merge source JSON, not parsed map points, so visits, activity modes and extra fields survive. */
export function mergeTimelineFiles(first: unknown, second: unknown): { data: unknown; summary: MergeSummary } {
  const left = source(first)
  const right = source(second)
  const fingerprints = new WeakMap<object, string>()
  const normalized = new WeakMap<object, unknown>()
  let conflicts = 0

  function fingerprint(value: unknown, key = ''): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(scalar(value, key)) ?? 'null'
    const cached = fingerprints.get(value)
    if (cached !== undefined) return cached
    const result = Array.isArray(value)
      ? `[${value.map(item => fingerprint(item)).join(',')}]`
      : `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${fingerprint(item, name)}`).join(',')}}`
    fingerprints.set(value, result)
    return result
  }

  function combine(a: unknown, b: unknown, key = '', pathStart?: number): unknown | typeof noMerge {
    if (a === undefined) return b
    if (b === undefined) return a
    if (empty(a)) return b
    if (empty(b) || fingerprint(a, key) === fingerprint(b, key)) return a
    if (Array.isArray(a) && Array.isArray(b)) return mergeableArray(key, a) && mergeableArray(key, b) ? combineRecords(a, b, key, pathStart) : noMerge
    const firstRecord = object(a)
    const secondRecord = object(b)
    if (!firstRecord || !secondRecord) return noMerge
    const start = instant(firstRecord.startTime) ?? instant(secondRecord.startTime) ?? pathStart
    const entries: [string, unknown][] = []
    for (const name of new Set([...Object.keys(firstRecord), ...Object.keys(secondRecord)])) {
      const firstValue = Object.hasOwn(firstRecord, name) ? firstRecord[name] : undefined
      const secondValue = Object.hasOwn(secondRecord, name) ? secondRecord[name] : undefined
      const result = combine(firstValue, secondValue, name, start)
      if (result === noMerge) return noMerge
      entries.push([name, result])
    }
    return Object.fromEntries(entries)
  }

  function normalize(value: unknown, key = '', pathStart?: number): unknown {
    if (value === null || typeof value !== 'object') return value
    if (normalized.has(value)) return normalized.get(value)
    let result: unknown
    if (Array.isArray(value)) {
      result = mergeableArray(key, value) ? combineRecords(value, [], key, pathStart) : value.map(item => normalize(item))
      // Repeated equal points can form a loop in a source path. Keep that
      // original sequence if removing them would contradict its own order.
      if (result === noMerge) result = value.map(item => normalize(item, '', pathStart))
    } else {
      const start = instant((value as JsonRecord).startTime) ?? pathStart
      const entries = Object.entries(value).map(([name, item]) => [name, normalize(item, name, start)] as const)
      result = entries.every(([name, item]) => item === (value as JsonRecord)[name]) ? value : Object.fromEntries(entries)
    }
    if (result !== value) normalized.set(value, result)
    return result
  }

  function batchAbsolutePaths(groups: unknown[][]): unknown[][] {
    const records = groups.flat()
    const parents = records.map((_, index) => index)
    function representative(index: number): number {
      while (parents[index] !== index) {
        parents[index] = parents[parents[index]!]!
        index = parents[index]!
      }
      return index
    }
    const anchors = new Map<string, number>()
    const metadataKinds = new Map<string, number>()
    for (let index = 0; index < records.length; index++) {
      const record = object(records[index])
      if (!record || !Array.isArray(record.timelinePath) || identity(record) !== undefined) continue
      const metadata = fingerprint(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'timelinePath')))
      const kind = metadataKinds.get(metadata) ?? metadataKinds.size
      metadataKinds.set(metadata, kind)
      for (const sample of identityKeys(record)) {
        const anchor = `${kind}:${sample}`
        const previous = anchors.get(anchor)
        if (previous !== undefined) parents[representative(index)] = representative(previous)
        else anchors.set(anchor, index)
      }
    }
    const clusters = new Map<number, number[]>()
    for (let index = 0; index < records.length; index++) {
      const root = representative(index)
      const members = clusters.get(root) ?? []
      members.push(index)
      clusters.set(root, members)
    }
    const batched: unknown[] = []
    for (const members of clusters.values()) {
      if (members.length === 1) batched.push(records[members[0]!])
      else {
        const paths = members.map(index => (records[index] as JsonRecord).timelinePath as unknown[])
        const mergedPath = combineRecords([], [], 'timelinePath', undefined, paths)
        if (mergedPath === noMerge) {
          conflicts++
          batched.push(...members.map(index => records[index]))
        } else batched.push({ ...object(records[members[0]!]), timelinePath: mergedPath })
      }
    }
    return [batched]
  }

  function combineRecords(a: unknown[], b: unknown[], key: string, pathStart?: number, groups = [a, b]): unknown[] | typeof noMerge {
    // Connected absolute paths can overlap through an intermediate segment.
    // Union their samples once per cluster, avoiding repeated copies of a
    // growing path when an export contains many small, matching containers.
    if (key === 'semanticSegments') groups = batchAbsolutePaths(groups)
    const result: unknown[] = []
    const parents: number[] = []
    function representative(index: number): number {
      while (parents[index] !== index) {
        parents[index] = parents[parents[index]!]!
        index = parents[index]!
      }
      return index
    }
    const exact = new Map<string, number>()
    const candidates = new Map<string, Set<number>>()
    const samplesByTime = new Map<string, Set<number>>()
    const incompleteByTime = new Map<string, Set<number>>()
    const incompleteGroups = new Set<string>()
    const knownLocations = new Map<string, string | null>()
    for (const records of groups) {
      for (const item of records) {
        const sample = sampleInfo(item, pathStart)
        if (sample && sample.location === undefined) incompleteGroups.add(sample.group)
      }
    }
    if (incompleteGroups.size) {
      for (const records of groups) {
        for (const item of records) {
          const sample = sampleInfo(item, pathStart)
          if (!sample?.location || !incompleteGroups.has(sample.group)) continue
          const previous = knownLocations.get(sample.group)
          knownLocations.set(sample.group, previous === undefined || previous === sample.location ? sample.location : null)
        }
      }
    }
    const sequences: number[][] = []
    function remember(map: Map<string, Set<number>>, name: string, index: number) {
      const bucket = map.get(name) ?? new Set<number>()
      bucket.add(index)
      map.set(name, bucket)
    }
    for (const records of groups) {
      const sequence: number[] = []
      for (const rawItem of records) {
        const item = normalize(rawItem, '', pathStart)
        const signature = fingerprint(item)
        let index = exact.get(signature)
        if (index !== undefined) index = representative(index)
        const matches = identityKeys(item, pathStart)
        const sample = sampleInfo(item, pathStart)
        const sampleGroup = sample?.group
        if (index === undefined && matches.length) {
          // Distinct observations sharing a timestamp can disagree. Exact duplicate
          // lookup remains constant-time even in very large ambiguous buckets.
          const possible = new Set<number>()
          for (const match of matches) {
            let checked = 0
            for (const candidate of candidates.get(match) ?? []) {
              possible.add(representative(candidate))
              if (++checked === 16) break
            }
          }
          if (!possible.size && sampleGroup && knownLocations.get(sampleGroup) !== null) {
            const fallback = (sample.location === undefined ? samplesByTime : incompleteByTime).get(sampleGroup)
            if (fallback?.size === 1) possible.add(fallback.values().next().value!)
          }
          for (const candidate of possible) {
            if (index === candidate) continue
            const savedConflicts = conflicts
            const merged = index === undefined
              ? combine(result[candidate], item, '', pathStart)
              : combine(result[index], result[candidate], '', pathStart)
            if (merged !== noMerge) {
              if (index === undefined) index = candidate
              else parents[candidate] = index
              const previousIdentity = identity(result[index], pathStart)
              if (previousIdentity?.endsWith(':missing')) candidates.get(previousIdentity)?.delete(index)
              result[index] = merged
              exact.set(fingerprint(merged), index)
              continue
            }
            conflicts = savedConflicts
          }
          if (index === undefined && possible.size) conflicts++
        }
        if (index === undefined) {
          index = result.length
          result.push(item)
          parents.push(index)
        }
        for (const match of matches) {
          if (!match.endsWith(':missing') || identity(result[index], pathStart)?.endsWith(':missing')) remember(candidates, match, index)
        }
        const mergedIdentity = identity(result[index], pathStart)
        if (mergedIdentity) remember(candidates, mergedIdentity, index)
        if (sampleGroup && incompleteGroups.has(sampleGroup)) {
          remember(samplesByTime, sampleGroup, index)
          if (identity(result[index], pathStart)?.endsWith(':missing')) remember(incompleteByTime, sampleGroup, index)
          else incompleteByTime.get(sampleGroup)?.delete(index)
        }
        exact.set(signature, index)
        sequence.push(index)
      }
      sequences.push(sequence)
    }
    const live = result.flatMap((_, index) => representative(index) === index ? [index] : [])
    if (key === 'timelinePath' || key === 'points') {
      // Preserve order within whole-minute paths. Sorting equal timestamps or
      // appending missing samples can otherwise change the route through them.
      const edges = result.map(() => new Set<number>())
      const incoming = result.map(() => 0)
      for (const sequence of sequences) {
        for (let i = 1; i < sequence.length; i++) {
          const before = representative(sequence[i - 1]!)
          const after = representative(sequence[i]!)
          if (before !== after && !edges[before]!.has(after)) {
            edges[before]!.add(after)
            incoming[after]!++
          }
        }
      }
      const ready = live.filter(index => incoming[index] === 0)
      const ordered: unknown[] = []
      for (let cursor = 0; cursor < ready.length; cursor++) {
        const index = ready[cursor]!
        ordered.push(result[index])
        for (const next of edges[index]!) {
          incoming[next]!--
          if (incoming[next] === 0) ready.push(next)
        }
      }
      return ordered.length === live.length
        ? ordered.sort((x, y) => (recordTime(x, pathStart) ?? Infinity) - (recordTime(y, pathStart) ?? Infinity))
        : noMerge
    }
    return live.map(index => result[index]).sort((x, y) => (recordTime(x) ?? Infinity) - (recordTime(y) ?? Infinity))
  }

  const merged: JsonRecord = {}
  let inputRecords = 0
  let outputRecords = 0
  for (const key of new Set([...left.arrays.keys(), ...right.arrays.keys()])) {
    const a = left.arrays.get(key) ?? []
    const b = right.arrays.get(key) ?? []
    const records = combineRecords(a, b, key) as unknown[]
    merged[key] = records
    inputRecords += a.length + b.length
    outputRecords += records.length
  }

  const metadata: JsonRecord[] = []
  const metadataSignatures = new Set<string>()
  for (const value of [...left.metadata, ...right.metadata]) {
    if (empty(value)) continue
    const signature = fingerprint(value)
    if (metadataSignatures.has(signature)) continue
    let matched = false
    for (let index = 0; index < metadata.length; index++) {
      const savedConflicts = conflicts
      const combined = combine(metadata[index], value)
      if (combined !== noMerge) {
        metadata[index] = combined as JsonRecord
        matched = true
        break
      }
      conflicts = savedConflicts
    }
    if (!matched) {
      if (metadata.length) conflicts++
      metadata.push(value)
    }
    metadataSignatures.add(signature)
  }
  let data: unknown = merged
  if (left.bare && right.bare) data = merged.semanticSegments
  else if (metadata.length === 1) data = { ...metadata[0], ...merged }
  else if (metadata.length > 1) data = { timelineExplorerMerge: { version: 1, sourceMetadata: metadata }, ...merged }
  return { data, summary: { inputRecords, outputRecords, duplicatesRemoved: inputRecords - outputRecords, conflicts } }
}
