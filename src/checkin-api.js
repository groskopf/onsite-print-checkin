export const EVENT_CODE_PATTERN = /^[A-Z2-7]{16}$/
export const ATTENDEE_CODE_PATTERN = /^[0-9a-f]{64}$/

export function normalizeEventCode(value) {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

// Facilitators share /checkin/?event=CODE so desks can skip typing the code.
export function linkedEventCode(search) {
  const value = new URLSearchParams(search).get('event')
  return value == null ? null : normalizeEventCode(value)
}

const isText = (value) => typeof value === 'string' && value.trim() !== ''
const isOptionalText = (value) => value == null || typeof value === 'string'

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function errorDetail(body, response) {
  return typeof body?.detail === 'string' ? body.detail
    : Array.isArray(body?.detail) ? body.detail.map((item) => item.msg).filter(Boolean).join('; ')
      : response.statusText
}

async function getJson(path, action, signal) {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, signal })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(`Unable to ${action} (${response.status})${errorDetail(body, response) ? `: ${errorDetail(body, response)}` : ''}`)
    error.status = response.status
    throw error
  }
  return body
}

export async function loadEvent(code, signal) {
  let event
  try {
    event = await getJson(`/api/v2/events/${encodeURIComponent(code)}`, 'open the event', signal)
  } catch (cause) {
    if (cause.status === 404 || cause.status === 422) {
      throw new Error('No event was found with this code. Check the code and try again.')
    }
    throw cause
  }
  if (event?.code !== code || !isText(event.name) || !isDate(event.start_date) || !isDate(event.end_date) ||
      event.end_date < event.start_date ||
      !['street', 'zip', 'town', 'country'].every((key) => isOptionalText(event[key]))) {
    throw new Error('The event API returned an unexpected response. Please try again.')
  }
  return event
}

export async function loadEventPrinters(eventCode, signal) {
  const [bookings, printers] = await Promise.all([
    getJson('/api/v2/bookings/', 'load bookings', signal),
    getJson('/api/v2/printers/', 'load printers', signal),
  ])
  if (!Array.isArray(bookings) || !Array.isArray(printers)) {
    throw new Error('The printers API returned an unexpected response. Please try again.')
  }
  const byCode = new Map(printers.map((printer) => [printer.code, printer]))
  const result = new Map()
  for (const booking of bookings.filter((item) => item.event_code === eventCode)) {
    const printer = byCode.get(booking.printer_code)
    if (!printer) throw new Error(`Printer ${booking.printer_code} could not be found.`)
    if (!isDate(booking.start_date) || !isDate(booking.end_date)) {
      throw new Error('The bookings API returned an invalid date.')
    }
    if (!result.has(printer.code)) result.set(printer.code, { ...printer, bookings: [] })
    result.get(printer.code).bookings.push(booking)
  }
  return [...result.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true }) || left.code.localeCompare(right.code))
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Name tags can only be created on a booking that covers today.
export function activeBooking(printer, today = localDate()) {
  return printer?.bookings.find((booking) => booking.start_date <= today && today <= booking.end_date) ?? null
}

export const printerName = (printer) => `Printer ${printer.label}`

// Passes encode the attendee code; a full attendee link is accepted too.
export function parseScan(text, eventCode) {
  const value = text.trim()
  if (ATTENDEE_CODE_PATTERN.test(value.toLowerCase())) return { attendeeCode: value.toLowerCase() }
  let url
  try {
    url = new URL(value)
  } catch {
    return { error: 'This code is not an Onsite Print check-in pass.' }
  }
  const match = url.pathname.match(/\/attendee\/([^/]+)\/([^/]+)\/?$/)
  if (!match) return { error: 'This code is not an Onsite Print check-in pass.' }
  const scannedEvent = match[1].toUpperCase()
  const attendeeCode = match[2].toLowerCase()
  if (!ATTENDEE_CODE_PATTERN.test(attendeeCode)) return { error: 'This code is not an Onsite Print check-in pass.' }
  if (scannedEvent !== eventCode) return { error: 'This pass belongs to another event.' }
  return { attendeeCode }
}

export async function loadAttendee(eventCode, attendeeCode, signal) {
  let attendee
  try {
    attendee = await getJson(
      `/api/v2/attendees/${encodeURIComponent(eventCode)}/${encodeURIComponent(attendeeCode)}`,
      'look up the attendee', signal,
    )
  } catch (cause) {
    if (cause.status === 404 || cause.status === 422) {
      throw new Error('This pass is not registered for this event.')
    }
    throw cause
  }
  if (attendee?.code !== attendeeCode || attendee.event_code !== eventCode ||
      !isText(attendee.first_name) || !isText(attendee.last_name) || !isOptionalText(attendee.company)) {
    throw new Error('The attendees API returned an unexpected response. Please try again.')
  }
  return attendee
}

export const fullName = (attendee) => `${attendee.first_name} ${attendee.last_name}`.trim()

export const NAMETAG_LAYOUT = 'layout_2'

// Legacy layouts print line 1 as the name and line 3 as the company.
export function nametagData(attendee) {
  return {
    layout: NAMETAG_LAYOUT,
    line_1: fullName(attendee),
    line_3: attendee.company?.trim() || null,
  }
}

export async function createNametag(eventCode, bookingCode, attendee, signal) {
  const response = await fetch(
    `/api/v2/nametags/${encodeURIComponent(eventCode)}/${encodeURIComponent(bookingCode)}`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(nametagData(attendee)),
      signal,
    },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = errorDetail(body, response)
    throw new Error(`Unable to print the name tag (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  if (typeof body?.filename !== 'string' || !body.filename) {
    throw new Error('The name tag API returned an unexpected response. Please try again.')
  }
  return body
}

function calendarDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatDateRange(start, end, locale = 'en-GB') {
  const format = (value, options) => new Intl.DateTimeFormat(locale, options).format(calendarDate(value))
  const full = { day: 'numeric', month: 'long', year: 'numeric' }
  if (start === end) return format(start, full)
  const [startYear, startMonth] = start.split('-')
  const [endYear, endMonth] = end.split('-')
  if (startYear === endYear && startMonth === endMonth) {
    return `${format(start, { day: 'numeric' })}–${format(end, full)}`
  }
  if (startYear === endYear) return `${format(start, { day: 'numeric', month: 'long' })} – ${format(end, full)}`
  return `${format(start, full)} – ${format(end, full)}`
}

export function eventLocation(event) {
  return [event.street, [event.zip, event.town].filter(Boolean).join(' '), event.country]
    .map((part) => part?.trim()).filter(Boolean).join(', ')
}

const EVENT_KEY = 'onsite-print:checkin-event'
const printerKey = (eventCode) => `onsite-print:checkin-printer:${eventCode}`

function readStorage(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

// Remembering choices is a convenience; private browsing may block storage.
function writeStorage(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Ignore storage failures.
  }
}

export const readStoredEvent = () => readStorage(EVENT_KEY)
export const storeEvent = (code) => writeStorage(EVENT_KEY, code)
export const readStoredPrinter = (eventCode) => readStorage(printerKey(eventCode))
export const storePrinter = (eventCode, printerCode) => writeStorage(printerKey(eventCode), printerCode)
