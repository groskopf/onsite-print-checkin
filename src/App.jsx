import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { ChecksumException, FormatException, NotFoundException } from '@zxing/library'

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

export default function App() {
  const videoRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (status !== 'scanning') return

    let active = true
    let stream
    let controls
    const reader = new BrowserMultiFormatReader()

    const stop = () => {
      controls?.stop()
      stream?.getTracks().forEach((track) => track.stop())
    }

    const fail = (cause) => {
      if (!active) return
      active = false
      stop()
      setError(cameraError(cause))
      setStatus('error')
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

        controls = await reader.decodeFromStream(stream, videoRef.current, (decoded, cause, scanControls) => {
          if (!active) return
          if (decoded) {
            active = false
            scanControls.stop()
            stop()
            setResult(decoded.getText())
            setStatus('success')
          } else if (cause && !(cause instanceof NotFoundException) &&
            !(cause instanceof ChecksumException) && !(cause instanceof FormatException)) {
            scanControls.stop()
            fail(cause)
          }
        })
        if (!active) stop()
      } catch (cause) {
        fail(cause)
      }
    }

    start()
    const onVisibilityChange = () => {
      if (document.hidden && active) {
        active = false
        stop()
        setStatus('idle')
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [status])

  function startScan() {
    setResult('')
    setError('')
    if (!window.isSecureContext) {
      setError('Camera access requires HTTPS. Open this page using a secure HTTPS address.')
      setStatus('error')
    } else if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support camera access. Try a current version of Safari or Chrome.')
      setStatus('error')
    } else {
      setStatus('scanning')
    }
  }

  return (
    <main className="scanner">
      <header>
        <p className="eyebrow">Onsite Print</p>
        <h1>Scan a barcode</h1>
        <p>Scan an attendee QR code or barcode with your phone camera.</p>
      </header>

      <section className="camera" aria-label="Barcode camera">
        {status === 'scanning' ? (
          <>
            <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" />
            <div className="scan-guide" aria-hidden="true" />
          </>
        ) : (
          <div className="camera-placeholder">
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M22 10H10v12m32-12h12v12M10 42v12h12m32-12v12H42M20 24v16m8-20v24m8-24v24m8-20v16" />
            </svg>
            <p>{status === 'success' ? 'Barcode captured' : 'Ready when you are'}</p>
          </div>
        )}
      </section>

      <div className="scan-status" role="status" aria-live="polite">
        {status === 'scanning' && <p>Point the camera at a code. Keep it steady and well lit.</p>}
        {status === 'idle' && <p>Tap Start scanning and allow camera access.</p>}
        {status === 'success' && (
          <section className="result" aria-labelledby="result-heading">
            <h2 id="result-heading">Scanned successfully</h2>
            <p className="result-value">{result}</p>
          </section>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {status === 'scanning' ? (
        <button className="secondary" onClick={() => setStatus('idle')}>Stop scanning</button>
      ) : (
        <button onClick={startScan}>
          {status === 'success' ? 'Scan next' : status === 'error' ? 'Try again' : 'Start scanning'}
        </button>
      )}
      <p className="privacy">Camera images stay on your device. Scanning does not check in an attendee.</p>
    </main>
  )
}