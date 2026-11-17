type LocalClock = { date: string; hour: number; minute: number; second: number }

/** Reuse formatters within an analysis. The ISO-style locale has a fast path
 * that avoids allocating date-part arrays for every movement interval. Keep
 * the parts fallback for runtimes whose locale data uses another layout. */
export function createLocalClock() {
  const formatters = new Map<string, Intl.DateTimeFormat>()
  return (time: number, zone: string): LocalClock => {
    let formatter = formatters.get(zone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      formatters.set(zone, formatter)
    }
    const formatted = formatter.format(time)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(formatted)) {
      return { date: formatted.slice(0, 10), hour: Number(formatted.slice(11, 13)), minute: Number(formatted.slice(14, 16)), second: Number(formatted.slice(17, 19)) }
    }
    const parts: Record<string, string> = {}
    for (const part of formatter.formatToParts(time)) if (part.type !== 'literal') parts[part.type] = part.value
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) }
  }
}
