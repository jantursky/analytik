import { useCallback, useEffect, useId, useState } from 'react'
import type { PrivacyMode } from 'analytik'

import { SITE_ID } from '../config'
import { MODES, deriveVisitorId, randomSalt, readDeviceStorage, type DeviceStorage } from '../lib/privacy'

const SAMPLE = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Macintosh) Firefox/130.0' }

const list = (names: string[]) => (names.length > 0 ? names.join(', ') : 'none')

export function PrivacyExample() {
  const [mode, setMode] = useState<PrivacyMode>('strict')
  const [ip, setIp] = useState(SAMPLE.ip)
  const [salt, setSalt] = useState(randomSalt)
  const [visitorId, setVisitorId] = useState('')
  const [device, setDevice] = useState<DeviceStorage>(readDeviceStorage)
  const ipId = useId()
  const facts = MODES.find((entry) => entry.mode === mode) ?? MODES[0]

  useEffect(() => {
    let current = true
    void deriveVisitorId(salt, SITE_ID, ip, SAMPLE.userAgent).then((id) => {
      if (current) setVisitorId(id)
    })
    return () => {
      current = false
    }
  }, [salt, ip])

  const refresh = useCallback(() => {
    setDevice(readDeviceStorage())
  }, [])

  if (!facts) return null

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Privacy mode">
        {MODES.map((entry) => (
          <button
            key={entry.mode}
            type="button"
            aria-pressed={mode === entry.mode}
            onClick={() => {
              setMode(entry.mode)
            }}
          >
            {entry.title}
          </button>
        ))}
      </div>

      <table className="table">
        <tbody>
          <tr>
            <th scope="row">Stored on the device</th>
            <td data-testid="fact-storage">{facts.deviceStorage}</td>
          </tr>
          <tr>
            <th scope="row">Visitor id</th>
            <td>{facts.visitorId}</td>
          </tr>
          <tr>
            <th scope="row">Consent banner</th>
            <td>{facts.banner}</td>
          </tr>
          <tr>
            <th scope="row">How long it links visits</th>
            <td>{facts.survives}</td>
          </tr>
        </tbody>
      </table>

      <div className="split">
        <div className="card stack">
          <h3>How a strict visitor id is made</h3>
          <p className="muted">
            The server hashes the site, IP and user agent with this month&apos;s random salt. The IP is then forgotten.
            When the month ends the salt is deleted, and nobody, including you, can link the ids back.
          </p>
          <label className="field" htmlFor={ipId}>
            IP address (documentation range, not yours)
            <input
              id={ipId}
              className="input mono"
              value={ip}
              onChange={(event) => {
                setIp(event.target.value)
              }}
            />
          </label>
          <p>
            Visitor id <code data-testid="visitor-id">{visitorId}</code>
          </p>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSalt(randomSalt())
              }}
            >
              End the month (delete the salt)
            </button>
            <span className="faint">The same visitor now gets a different id.</span>
          </div>
        </div>

        <div className="card stack">
          <h3>On this device right now</h3>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Cookies</th>
                <td data-testid="device-cookies">{list(device.cookies)}</td>
              </tr>
              <tr>
                <th scope="row">localStorage</th>
                <td data-testid="device-local">{list(device.localStorage)}</td>
              </tr>
              <tr>
                <th scope="row">sessionStorage</th>
                <td data-testid="device-session">{list(device.sessionStorage)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted">
            Switch consent on in the Instrumented site tab, come back and refresh: the tab id appears. Withdraw consent
            and it is removed.
          </p>
          <div>
            <button type="button" className="btn" onClick={refresh}>
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PrivacyExample
