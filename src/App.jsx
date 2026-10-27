import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import {
  EVENT_CODE_PATTERN, activeBooking, createNametag, eventLocation, formatDateRange, fullName, linkedEventCode,
  loadAttendee, loadEvent, loadEventPrinters, normalizeEventCode, parseScan, printerName, readStoredEvent, readStoredPrinter,
  storeEvent, storePrinter,
} from './checkin-api.js'

// A pass counts as a new scan only after it has been out of view this long.
const PASS_GONE_MS = 1500
const SCAN_INTERVAL_MS = 150
// Larger frames are scaled down before decoding to keep slower phones responsive.
const MAX_SCAN_SIZE = 720

function cameraError(error) {
  switch (error.name) {
    case 'NotAllowedError':
      return 'Camera access was denied. Allow camera access in your browser settings, then try again.'
    case 'NotFoundError':
      return 'No camera was found. Try a phone or another device with a camera.'
    case 'NotReadableError':
      return 'The camera is busy or unavailable. Close other apps using it, then try again.'
    default:
      return `Unable to scan: ${error.message || error.name}. Please try again.`
  }
}

function cameraSupportError() {
  if (!window.isSecureContext) return 'Camera access requires HTTPS. Open this page using a secure HTTPS address.'
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser does not support camera access. Try a current version of Safari or Chrome.'
  }
  return ''
}

function SiteHeader() {
  return (
    <header className="site-header">
      <span className="brand" role="img" aria-label="Onsite Print">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
        <span className="brand-name" aria-hidden="true">ONSITE<br />PRINT</span>
      </span>
      <a className="site-link" href="https://onsiteprint.dk" rel="noreferrer">onsiteprint.dk</a>
    </header>
  )
}

function EventEntry({ initialError, onOpen }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(initialError)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => inputRef.current?.focus(), [])

  async function submit(submitEvent) {
    submitEvent.preventDefault()
    const normalized = normalizeEventCode(code)
    if (!EVENT_CODE_PATTERN.test(normalized)) {
      setError('Enter the 16-character event code using letters A–Z and digits 2–7.')
      return
    }
    setError('')
    setLoading(true)
    try {
      onOpen(await loadEvent(normalized))
    } catch (cause) {
      setError(cause instanceof TypeError ? 'Unable to connect. Check your connection and try again.' : cause.message)
      setLoading(false)
    }
  }

  return (
    <section className="card" aria-labelledby="event-entry-heading">
      <p className="eyebrow">Check-in scanner</p>
      <h1 id="event-entry-heading">Open your event</h1>
      <p>Enter the event code you received from Onsite Print.</p>
      <form className="event-form" onSubmit={submit} noValidate>
        <label htmlFor="event-code">Event code</label>
        <input
          ref={inputRef}
          id="event-code"
          value={code}
          onChange={(changeEvent) => setCode(changeEvent.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          maxLength={24}
          placeholder="ABCDEFGH23456723"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'event-code-error' : undefined}
        />
        {error && <p id="event-code-error" className="error" role="alert">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? 'Opening…' : 'Continue'}</button>
      </form>
    </section>
  )
}

function EventSummary({ event }) {
  const location = eventLocation(event)
  return (
    <div className="event-summary">
      <h2>{event.name}</h2>
      <p>
        <time dateTime={event.start_date}>{formatDateRange(event.start_date, event.end_date)}</time>
        {location && <> · {location}</>}
      </p>
    </div>
  )
}

function PrinterPicker({ event, printers, selectedCode, onSelect, onCancel, onLogout }) {
  const available = printers.filter((printer) => activeBooking(printer))
  return (
    <section className="card" aria-labelledby="printer-heading">
      <EventSummary event={event} />
      <h1 id="printer-heading">Choose a printer</h1>
      <p>Name tags for scanned passes are printed here.</p>
      {printers.length === 0 ? (
        <p className="error" role="alert">This event has no printers booked.</p>
      ) : available.length === 0 && (
        <p className="error" role="alert">None of this event's printers are booked for today.</p>
      )}
      <ul className="printer-list">
        {printers.map((printer) => {
          const booked = Boolean(activeBooking(printer))
          const selected = printer.code === selectedCode
          return (
            <li key={printer.code}>
              <button
                type="button"
                className={`printer-option${selected ? ' selected' : ''}`}
                disabled={!booked}
                aria-pressed={selected}
                onClick={() => onSelect(printer.code)}
              >
                <strong>{printerName(printer)}</strong>
                <span>{booked ? printer.description || printer.code : 'Not booked for today'}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="actions">
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
        <button type="button" className="secondary" onClick={onLogout}>Log out</button>
      </div>
    </section>
  )
}

function Scanner({ event, printer, onChangePrinter, onLogout }) {
  const videoRef = useRef(null)
  const seenRef = useRef({ text: '', time: 0 })
  const dialogOpenRef = useRef(false)
  const controllerRef = useRef(null)
  const [scanning, setScanning] = useState(() => !cameraSupportError())
  const [cameraProblem, setCameraProblem] = useState(() => cameraSupportError())
  const [scan, setScan] = useState(null)
  const [printed, setPrinted] = useState(null)

  const openScan = useCallback((next) => {
    dialogOpenRef.current = Boolean(next)
    setScan(next)
  }, [])

  const handleScan = useCallback(async (text) => {
    const now = Date.now()
    const seen = seenRef.current
    seenRef.current = { text, time: now }
    if ((seen.text === text && now - seen.time < PASS_GONE_MS) || dialogOpenRef.current) return

    const parsed = parseScan(text, event.code)
    if (parsed.error) {
      openScan({ kind: 'error', message: parsed.error })
      return
    }
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    openScan({ kind: 'loading' })
    try {
      const attendee = await loadAttendee(event.code, parsed.attendeeCode, controller.signal)
      if (!controller.signal.aborted) openScan({ kind: 'welcome', attendee })
    } catch (cause) {
      if (controller.signal.aborted) return
      openScan({
        kind: 'error',
        message: cause instanceof TypeError ? 'Unable to connect. Check your connection and scan again.' : cause.message,
      })
    }
  }, [event.code, openScan])

  function closeScan() {
    controllerRef.current?.abort()
    openScan(null)
  }

  async function printNametag() {
    const { attendee } = scan
    const booking = activeBooking(printer)
    if (!booking) {
      openScan({ kind: 'welcome', attendee, error: `${printerName(printer)} is not booked for today. Choose another printer.` })
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    openScan({ kind: 'printing', attendee })
    try {
      await createNametag(event.code, booking.booking_code, attendee, controller.signal)
      if (controller.signal.aborted) return
      openScan(null)
      setPrinted(attendee)
      navigator.vibrate?.(80)
    } catch (cause) {
      if (controller.signal.aborted) return
      openScan({
        kind: 'welcome',
        attendee,
        error: cause instanceof TypeError ? 'Unable to connect. Check your connection and try again.' : cause.message,
      })
    }
  }

  const handleScanRef = useRef(handleScan)
  useEffect(() => {
    handleScanRef.current = handleScan
  }, [handleScan])

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    if (!scanning) return undefined

    let active = true
    let stream
    let timer
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })

    const stop = () => {
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }

    const scanFrame = () => {
      if (!active) return
      const video = videoRef.current
      if (video?.readyState >= video?.HAVE_CURRENT_DATA && video.videoWidth) {
        const scale = Math.min(1, MAX_SCAN_SIZE / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
        if (code?.data) handleScanRef.current(code.data)
      }
      timer = setTimeout(scanFrame, SCAN_INTERVAL_MS)
    }

    const fail = (cause) => {
      if (!active) return
      active = false
      stop()
      setCameraProblem(cameraError(cause))
      setScanning(false)
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        })
        if (!active) {
          stop()
          return
        }
        const video = videoRef.current
        video.srcObject = stream
        await video.play()
        if (!active) {
          stop()
          return
        }
        scanFrame()
      } catch (cause) {
        fail(cause)
      }
    }

    start()
    const onVisibilityChange = () => {
      if (document.hidden && active) {
        active = false
        stop()
        setScanning(false)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [scanning])

  function startScan() {
    const problem = cameraSupportError()
    setCameraProblem(problem)
    setScanning(!problem)
  }

  return (
    <div className="scanner">
      <section className="station" aria-label="Check-in station">
        <EventSummary event={event} />
        <div className="station-printer">
          <span>
            <strong>{printerName(printer)}</strong>
            {printer.description && <small>{printer.description}</small>}
          </span>
          <button type="button" className="link-button" onClick={onChangePrinter}>Change printer</button>
        </div>
      </section>

      <section className="camera" aria-label="QR code camera">
        {scanning ? (
          <>
            <video ref={videoRef} muted playsInline aria-label="Live camera preview" />
            <div className="scan-guide" aria-hidden="true" />
          </>
        ) : (
          <div className="camera-placeholder">
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M22 10H10v12m32-12h12v12M10 42v12h12m32-12v12H42M20 24v16m8-20v24m8-24v24m8-20v16" />
            </svg>
            <p>Camera is off</p>
          </div>
        )}
      </section>

      <div className="scan-status" role="status" aria-live="polite">
        {printed && (
          <div className="result success">
            <h2>Name tag printed</h2>
            <p className="result-name">{fullName(printed)}</p>
            {printed.company && <p>{printed.company}</p>}
            <p className="result-meta">Sent to {printerName(printer)}</p>
          </div>
        )}
        {scanning && <p>Hold the attendee's QR code inside the frame.</p>}
      </div>
      {cameraProblem && <p className="error" role="alert">{cameraProblem}</p>}

      {scanning ? (
        <button className="secondary" onClick={() => setScanning(false)}>Stop camera</button>
      ) : (
        <button onClick={startScan}>{cameraProblem ? 'Try again' : 'Start scanning'}</button>
      )}
      <button type="button" className="link-button logout" onClick={onLogout}>Log out</button>
      <p className="privacy">Camera images stay on your device.</p>
      {scan && <ScanDialog scan={scan} printer={printer} onPrint={printNametag} onClose={closeScan} />}
    </div>
  )
}

function Modal({ labelledBy, describedBy, className = '', onCancel, children }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={`confirm-dialog ${className}`.trim()}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(cancelEvent) => {
        cancelEvent.preventDefault()
        onCancel()
      }}
      onKeyDown={(keyEvent) => {
        // Some browsers don't send a cancel event for Escape on a modal dialog.
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault()
          onCancel()
        }
      }}
    >
      {children}
    </dialog>
  )
}

function ScanDialog({ scan, printer, onPrint, onClose }) {
  if (scan.kind === 'loading') {
    return (
      <Modal labelledBy="scan-heading" onCancel={onClose}>
        <h2 id="scan-heading">Looking up the pass…</h2>
        <div className="actions">
          <button type="button" className="secondary" onClick={onClose} autoFocus>Cancel</button>
        </div>
      </Modal>
    )
  }

  if (scan.kind === 'error') {
    return (
      <Modal labelledBy="scan-heading" describedBy="scan-error" className="scan-error" onCancel={onClose}>
        <h2 id="scan-heading">Pass not accepted</h2>
        <p id="scan-error" className="error" role="alert">{scan.message}</p>
        <div className="actions">
          <button type="button" onClick={onClose} autoFocus>OK</button>
        </div>
      </Modal>
    )
  }

  const printing = scan.kind === 'printing'
  return (
    <Modal labelledBy="welcome-name" describedBy="welcome-details" className="welcome" onCancel={onClose}>
      <p className="welcome-greeting">Welcome</p>
      <h2 id="welcome-name">{fullName(scan.attendee)}</h2>
      <div id="welcome-details">
        {scan.attendee.company && <p className="welcome-company">{scan.attendee.company}</p>}
        <p className="result-meta">Name tag prints on {printerName(printer)}.</p>
      </div>
      {scan.error && <p className="error" role="alert">{scan.error}</p>}
      <div className="actions">
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        <button type="button" onClick={onPrint} disabled={printing} autoFocus>
          {printing ? 'Printing…' : scan.error ? 'Try again' : 'Print'}
        </button>
      </div>
    </Modal>
  )
}

function LogoutDialog({ event, printer, onConfirm, onCancel }) {
  return (
    <Modal labelledBy="logout-heading" describedBy="logout-description" onCancel={onCancel}>
      <h2 id="logout-heading">Log out of this station?</h2>
      <p id="logout-description">
        This device stops checking in attendees for <strong>{event.name}</strong>
        {printer && <> on <strong>{printerName(printer)}</strong></>}. You will need the event code to start again.
      </p>
      <div className="actions">
        <button type="button" className="secondary" onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className="danger" onClick={onConfirm}>Log out</button>
      </div>
    </Modal>
  )
}

function readInitialEvent() {
  const linked = linkedEventCode(window.location.search)
  if (linked === null) return { code: readStoredEvent(), error: '' }
  return EVENT_CODE_PATTERN.test(linked)
    ? { code: linked, error: '' }
    : { code: null, error: 'The check-in link has an invalid event code. Enter the event code instead.' }
}

export default function App() {
  const [initialEvent] = useState(readInitialEvent)
  const storedEvent = initialEvent.code
  const [event, setEvent] = useState(null)
  const [eventError, setEventError] = useState(initialEvent.error)
  const [restoring, setRestoring] = useState(() => Boolean(storedEvent))
  const [printers, setPrinters] = useState(null)
  const [printerError, setPrinterError] = useState('')
  const [printerCode, setPrinterCode] = useState(null)
  const [choosingPrinter, setChoosingPrinter] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  useEffect(() => {
    // Drop the code from the address so reloading after logout does not reopen the linked event.
    const url = new URL(window.location.href)
    if (!url.searchParams.has('event')) return
    url.searchParams.delete('event')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  useEffect(() => {
    if (!storedEvent) return undefined
    const controller = new AbortController()
    loadEvent(storedEvent, controller.signal)
      .then((loaded) => openEvent(loaded))
      .catch((cause) => {
        if (controller.signal.aborted) return
        if (!(cause instanceof TypeError)) storeEvent(null)
        setEventError(cause instanceof TypeError ? 'Unable to connect. Check your connection and try again.' : cause.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false)
      })
    return () => controller.abort()
  }, [storedEvent])

  useEffect(() => {
    if (!event) return undefined
    const controller = new AbortController()
    loadEventPrinters(event.code, controller.signal)
      .then((loaded) => setPrinters(loaded))
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setPrinterError(cause instanceof TypeError ? 'Unable to connect. Check your connection and try again.' : cause.message)
        }
      })
    return () => controller.abort()
  }, [event, attempt])

  useEffect(() => {
    document.title = event ? `${event.name} | Onsite Print Check-in` : 'Onsite Print Check-in'
  }, [event])

  function openEvent(loaded) {
    storeEvent(loaded.code)
    setEvent(loaded)
    setEventError('')
    setPrinters(null)
    setPrinterError('')
    setPrinterCode(readStoredPrinter(loaded.code))
    setChoosingPrinter(false)
  }

  function requestLogout() {
    setConfirmingLogout(true)
  }

  function logout() {
    setConfirmingLogout(false)
    storeEvent(null)
    setEvent(null)
    setPrinters(null)
    setPrinterError('')
    setPrinterCode(null)
    setChoosingPrinter(false)
  }

  function selectPrinter(code) {
    storePrinter(event.code, code)
    setPrinterCode(code)
    setChoosingPrinter(false)
  }

  const printer = printers?.find((item) => item.code === printerCode) ?? null
  const printerReady = Boolean(activeBooking(printer))

  let content
  if (restoring) {
    content = <p className="loading" role="status">Opening your event…</p>
  } else if (!event) {
    content = <EventEntry initialError={eventError} onOpen={openEvent} />
  } else if (printerError) {
    content = (
      <section className="card" aria-labelledby="printer-error-heading">
        <h1 id="printer-error-heading">Printers could not be loaded</h1>
        <p className="error" role="alert">{printerError}</p>
        <div className="actions">
          <button type="button" onClick={() => { setPrinterError(''); setAttempt((value) => value + 1) }}>Try again</button>
          <button type="button" className="secondary" onClick={requestLogout}>Log out</button>
        </div>
      </section>
    )
  } else if (!printers) {
    content = <p className="loading" role="status">Loading printers…</p>
  } else if (!printerReady || choosingPrinter) {
    content = (
      <PrinterPicker
        event={event}
        printers={printers}
        selectedCode={printerReady ? printerCode : null}
        onSelect={selectPrinter}
        onCancel={printerReady ? () => setChoosingPrinter(false) : null}
        onLogout={requestLogout}
      />
    )
  } else {
    content = (
      <Scanner
        key={`${event.code}:${printer.code}`}
        event={event}
        printer={printer}
        onChangePrinter={() => setChoosingPrinter(true)}
        onLogout={requestLogout}
      />
    )
  }

  return (
    <div className="page">
      <SiteHeader />
      <main>{content}</main>
      {confirmingLogout && event && (
        <LogoutDialog
          event={event}
          printer={printerReady && !choosingPrinter ? printer : null}
          onConfirm={logout}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </div>
  )
}
