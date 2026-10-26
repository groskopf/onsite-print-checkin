import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeBooking, createNametag, eventLocation, formatDateRange, loadAttendee, loadEventPrinters,
  nametagData, normalizeEventCode, parseScan,
} from '../src/checkin-api.js'

const EVENT = 'LW6MOVT3IZAABDXE'
const CODE = 'a'.repeat(64)

function mockFetch(routes) {
  const calls = []
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, options })
    const [status, body] = routes[path] ?? [404, { detail: 'Not Found' }]
    return { ok: status < 400, status, statusText: 'status', json: async () => body }
  }
  return calls
}

test('normalizes event codes and parses scanned passes', () => {
  assert.equal(normalizeEventCode(' lw6m-ovt3 izaa bdxe '), EVENT)
  assert.deepEqual(parseScan(` ${CODE.toUpperCase()} `, EVENT), { attendeeCode: CODE })
  assert.deepEqual(parseScan(`https://x.dk/attendee/${EVENT.toLowerCase()}/${CODE}/`, EVENT), { attendeeCode: CODE })
  assert.match(parseScan(`https://x.dk/attendee/AAAAAAAAAAAAAAAA/${CODE}`, EVENT).error, /another event/)
  assert.match(parseScan('https://example.com', EVENT).error, /not an Onsite Print/)
  assert.match(parseScan('hello', EVENT).error, /not an Onsite Print/)
})

test('loads the event printers and finds the booking for today', async () => {
  mockFetch({
    '/api/v2/bookings/': [200, [
      { event_code: EVENT, printer_code: 'P_2', booking_code: 'B2', start_date: '2026-10-24', end_date: '2026-10-25' },
      { event_code: 'OTHER', printer_code: 'P_1', booking_code: 'B1', start_date: '2026-10-24', end_date: '2026-10-25' },
    ]],
    '/api/v2/printers/': [200, [{ code: 'P_1', label: '1' }, { code: 'P_2', label: '2' }]],
  })
  const printers = await loadEventPrinters(EVENT)
  assert.deepEqual(printers.map((printer) => printer.code), ['P_2'])
  assert.equal(activeBooking(printers[0], '2026-10-25').booking_code, 'B2')
  assert.equal(activeBooking(printers[0], '2026-10-26'), null)
})

test('looks up the attendee and creates the name tag', async () => {
  const attendee = { code: CODE, event_code: EVENT, first_name: 'Karen', last_name: 'Blixen', company: ' Rungstedlund ' }
  const calls = mockFetch({
    [`/api/v2/attendees/${EVENT}/${CODE}`]: [200, attendee],
    [`/api/v2/nametags/${EVENT}/B2`]: [200, { filename: 'tag.pdf' }],
  })
  assert.equal((await loadAttendee(EVENT, CODE)).last_name, 'Blixen')
  await assert.rejects(loadAttendee(EVENT, 'b'.repeat(64)), /not registered for this event/)
  assert.deepEqual(await createNametag(EVENT, 'B2', attendee), { filename: 'tag.pdf' })
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), nametagData(attendee))
  assert.deepEqual(nametagData(attendee), { layout: 'layout_2', line_1: 'Karen Blixen', line_3: 'Rungstedlund' })
  await assert.rejects(createNametag(EVENT, 'NOPE', attendee), /Unable to print the name tag \(404\): Not Found/)
})

test('formats event dates and location', () => {
  assert.equal(formatDateRange('2026-10-24', '2026-10-25'), '24–25 October 2026')
  assert.equal(eventLocation({ street: 'Main 1', zip: '8970', town: 'Poperinge', country: 'Belgien' }),
    'Main 1, 8970 Poperinge, Belgien')
})
