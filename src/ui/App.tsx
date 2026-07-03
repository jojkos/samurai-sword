import { useEffect, useRef, useState } from 'react'
import type { PlayerView } from '../engine/types'
import {
  clearGuestRoom,
  clearHostSave,
  GuestSession,
  HostSession,
  loadGuestRoom,
  loadHostSave,
  Session,
} from '../net/session'
import type { LobbyPlayer } from '../net/protocol'
import { GameScreen } from './GameScreen'
import { InkScene } from './InkScene'
import { sound } from './sound'

type Screen =
  | { s: 'home' }
  | { s: 'connecting'; code: string }
  | { s: 'lobby'; players: LobbyPlayer[]; code: string; seat: number }
  | { s: 'game' }

/** kanji numerals for the seven lobby seats — 一 through 七 */
const SEAT_KANJI = ['一', '二', '三', '四', '五', '六', '七']

export function App() {
  const [screen, setScreen] = useState<Screen>({ s: 'home' })
  const [view, setView] = useState<PlayerView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dead, setDead] = useState<string | null>(null)
  const [name, setName] = useState(() => localStorage.getItem('samurai-sword-name') ?? '')
  const [joinCode, setJoinCode] = useState(
    () => new URLSearchParams(location.search).get('join')?.toUpperCase() ?? '',
  )
  const [soundOn, setSoundOn] = useState(() => sound.isEnabled())
  // transient "copied" confirmation on the lobby's copy-link button
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)
  // inline field affordance mirroring the error toast (name / room code)
  const [fieldError, setFieldError] = useState<{ field: 'name' | 'code'; msg: string } | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const hostSave = loadHostSave()

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 4000)
      return () => clearTimeout(t)
    }
  }, [error])

  // audio unlocks on the first gesture (browser autoplay policy); every button clicks
  useEffect(() => {
    const unlock = () => sound.unlock()
    const click = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.('.btn, .ink-seal, .ink-resume')) sound.uiClick()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('click', click)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('click', click)
    }
  }, [])

  // a warrior joins the lobby → koto ding
  const lobbyCount = screen.s === 'lobby' ? screen.players.length : 0
  const prevLobbyCount = useRef(0)
  useEffect(() => {
    if (lobbyCount > prevLobbyCount.current && prevLobbyCount.current > 0) sound.playerJoin()
    prevLobbyCount.current = lobbyCount
  }, [lobbyCount])

  // a reload should land you back where you were, not on the menu:
  // hosts reclaim their room, guests rejoin theirs (their seat token is per-tab)
  useEffect(() => {
    if (sessionRef.current) return
    if (loadHostSave()) {
      resumeRoom()
      return
    }
    const room = loadGuestRoom()
    const invited = new URLSearchParams(location.search).get('join')?.toUpperCase()
    // a fresh invite link to a DIFFERENT room wins — forget the remembered one
    if (room && invited && invited !== room.code) {
      clearGuestRoom()
      return
    }
    if (room?.name && (!invited || invited === room.code)) {
      setDead(null)
      const session = new GuestSession(room.code, room.name, events())
      sessionRef.current = session
      setScreen({ s: 'connecting', code: session.code })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function events() {
    return {
      onLobby: (players: LobbyPlayer[], code: string, seat: number) =>
        setScreen((prev) => (prev.s === 'game' ? prev : { s: 'lobby', players, code, seat })),
      onView: (v: PlayerView) => {
        setView(v)
        setScreen({ s: 'game' })
      },
      onError: (message: string) => setError(message),
      onDead: (reason: string) => {
        setDead(reason)
        sessionRef.current?.close()
        sessionRef.current = null
      },
    }
  }

  function rememberName() {
    localStorage.setItem('samurai-sword-name', name)
  }

  function createRoom() {
    if (!name.trim()) {
      setFieldError({ field: 'name', msg: 'First tell us your name, warrior.' })
      nameInputRef.current?.focus()
      return setError('First tell us your name, warrior.')
    }
    setFieldError(null)
    rememberName()
    clearHostSave()
    setDead(null)
    const session = new HostSession(name.trim(), events())
    sessionRef.current = session
    setScreen({ s: 'connecting', code: session.code })
  }

  function resumeRoom() {
    const save = loadHostSave()
    if (!save) return
    setDead(null)
    const session = new HostSession(save.roster.names[0], events(), save)
    sessionRef.current = session
    setScreen({ s: 'connecting', code: session.code })
  }

  function joinRoom() {
    if (!name.trim()) {
      setFieldError({ field: 'name', msg: 'First tell us your name, warrior.' })
      nameInputRef.current?.focus()
      return setError('First tell us your name, warrior.')
    }
    if (joinCode.trim().length < 4) {
      setFieldError({ field: 'code', msg: 'Enter the 4-letter room code.' })
      codeInputRef.current?.focus()
      return setError('Enter the 4-letter room code.')
    }
    setFieldError(null)
    rememberName()
    setDead(null)
    const session = new GuestSession(joinCode.trim(), name.trim(), events())
    sessionRef.current = session
    setScreen({ s: 'connecting', code: session.code })
  }

  function copyInvite(code: string) {
    navigator.clipboard?.writeText(`${location.origin}${location.pathname}?join=${code}`)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  function leave() {
    // a deliberate exit from the lobby/game closes the room for good; cancelling
    // a connection attempt keeps the save so a reload can still resume it
    if (sessionRef.current instanceof HostSession && screen.s !== 'connecting') clearHostSave()
    sessionRef.current?.close()
    sessionRef.current = null
    setView(null)
    setDead(null)
    setCopied(false)
    setScreen({ s: 'home' })
  }

  const session = sessionRef.current

  return (
    // home lives inside a daylight ink painting; every other screen keeps the night scene
    <div className={screen.s === 'home' ? 'app app-ink' : 'app'}>
      <SharedFilterDefs />
      {screen.s === 'home' ? <InkScene /> : <SceneBackdrop />}
      <button
        className={`sound-toggle ${soundOn ? '' : 'sound-toggle-muted'}`}
        onClick={() => {
          const next = !soundOn
          setSoundOn(next)
          sound.setEnabled(next)
        }}
        title={soundOn ? 'Mute sound' : 'Unmute sound'}
        aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
      >
        音
      </button>
      {error && <div className="toast toast-error">{error}</div>}

      {dead && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Disconnected</h2>
            <p>{dead}</p>
            <button className="btn" onClick={leave}>Back</button>
          </div>
        </div>
      )}

      {screen.s === 'home' && (
        <div className="ink-home">
          <header className="ink-crest">
            {/* ensō — a single brush ring drawing itself around the crest kanji */}
            <div className="ink-enso" aria-hidden="true">
              <svg viewBox="0 0 200 200">
                <path
                  className="ink-enso-stroke" pathLength="1"
                  d="M112 21 C64 14 24 52 22 99 C20 149 61 184 106 181 C152 178 181 141 178 97 C176 63 155 38 126 27"
                  fill="none" stroke="#26211a" strokeWidth="8" strokeLinecap="round"
                />
              </svg>
              <span className="ink-crest-kanji">侍</span>
            </div>
            <h1 className="ink-title">Samurai Sword</h1>
            {/* the sword slash — one vermilion stroke cut beneath the name */}
            <svg className="ink-slash" viewBox="0 0 420 36" preserveAspectRatio="none" aria-hidden="true">
              <path
                className="ink-slash-stroke" pathLength="1"
                d="M6 24 Q120 10 250 17 Q340 21 414 12"
                fill="none" stroke="#c3282f" strokeWidth="9" strokeLinecap="round"
              />
              <path
                className="ink-slash-stroke ink-slash-echo" pathLength="1"
                d="M14 30 Q150 20 292 24 Q360 25 410 20"
                fill="none" stroke="#c3282f" strokeWidth="3" strokeLinecap="round"
              />
            </svg>
            <p className="ink-subtitle">刀 · The Way of Honor</p>
            <p className="ink-tagline">Hidden roles. Stolen honor. 3–7 warriors, online.</p>
          </header>

          <div className="ink-form">
            {/* the name is written straight onto the paper, over a brushed rule */}
            <div className="ink-field">
              <label className="ink-label" htmlFor="warrior-name">Your name, warrior</label>
              <div className={`ink-writing ${fieldError?.field === 'name' ? 'ink-writing-invalid' : ''}`}>
                <input
                  id="warrior-name"
                  ref={nameInputRef}
                  className="ink-input"
                  placeholder="e.g. Musashi"
                  maxLength={16}
                  value={name}
                  aria-invalid={fieldError?.field === 'name' || undefined}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (fieldError?.field === 'name') setFieldError(null)
                  }}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && (joinCode.trim().length === 4 ? joinRoom() : createRoom())
                  }
                />
                <svg className="ink-underline" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden="true">
                  <path pathLength="1" d="M4 8 Q80 3 152 7 Q226 10 296 5" fill="none" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
              {fieldError?.field === 'name' && (
                <span className="ink-error" role="alert">{fieldError.msg}</span>
              )}
            </div>

            <div className="ink-actions">
              <div className="ink-action">
                <span className="ink-label ink-label-center">Gather your clan</span>
                {/* hanko seal — pressed into the paper */}
                <button className="ink-seal ink-seal-vermilion" onClick={createRoom}>
                  <span className="ink-seal-kanji" aria-hidden="true">結</span>
                  <span className="ink-seal-text">Create a room</span>
                </button>
              </div>
              <div className="ink-or" aria-hidden="true"><span>or</span></div>
              <div className="ink-action">
                <span className="ink-label ink-label-center">Answer the call</span>
                <div className="ink-join">
                  {/* the room code sits inside a painted cartouche */}
                  <div className={`ink-cartouche ${fieldError?.field === 'code' ? 'ink-cartouche-invalid' : ''}`}>
                    <svg className="ink-cartouche-frame" viewBox="0 0 120 58" preserveAspectRatio="none" aria-hidden="true">
                      <rect className="ink-cartouche-stroke" pathLength="1" x="3" y="3" width="114" height="52" rx="6" fill="none" strokeWidth="3" />
                    </svg>
                    <input
                      ref={codeInputRef}
                      className="ink-code"
                      placeholder="CODE"
                      maxLength={4}
                      value={joinCode}
                      aria-invalid={fieldError?.field === 'code' || undefined}
                      onChange={(e) => {
                        setJoinCode(e.target.value.toUpperCase())
                        if (fieldError?.field === 'code') setFieldError(null)
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                    />
                  </div>
                  <button className="ink-seal ink-seal-ink" onClick={joinRoom}>
                    <span className="ink-seal-kanji" aria-hidden="true">参</span>
                    <span className="ink-seal-text">Join</span>
                  </button>
                </div>
                {fieldError?.field === 'code' && (
                  <span className="ink-error" role="alert">{fieldError.msg}</span>
                )}
              </div>
            </div>

            {hostSave && (
              <button className="ink-resume" onClick={resumeRoom}>
                <span className="ink-resume-seal" aria-hidden="true">再</span>
                Resume hosting room {hostSave.code}
                {hostSave.state ? ' (game in progress)' : ''}
              </button>
            )}
          </div>

          {/* the colophon — how it works, signed with the painter's seal */}
          <p className="ink-note">
            One player creates a room and shares its code. Everyone connects directly to the
            host&apos;s browser — no accounts, nothing to install. Keep the host tab open.
            <span className="ink-note-seal" aria-hidden="true">侍</span>
          </p>
        </div>
      )}

      {screen.s === 'connecting' && (
        <div className="home">
          <h2 className="pulse">Opening room {screen.code}…</h2>
          <button className="btn btn-ghost" onClick={leave}>Cancel</button>
        </div>
      )}

      {screen.s === 'lobby' && session && (
        <div className="home">
          <h1 className="home-title"><span className="home-kanji">侍</span>Samurai Sword</h1>
          <div className="home-panel lobby-panel">
            <div className="lobby-invite">
              <span className="lobby-invite-label">招 · Summon your clan</span>
              <div className="lobby-invite-row">
                <div className="lobby-invite-code">
                  <strong className="lobby-code-hero">{screen.code}</strong>
                  <span className="lobby-invite-hint">speak the code, or share the link</span>
                  <button
                    className={`btn btn-small lobby-copy ${copied ? 'lobby-copy-done' : ''}`}
                    onClick={() => copyInvite(screen.code)}
                    title="Copy invite link"
                    aria-live="polite"
                  >
                    {copied ? '✓ link copied' : 'copy invite link'}
                  </button>
                </div>
                <JoinQr code={screen.code} />
              </div>
            </div>
            <span className="home-label">Warriors · {screen.players.length}/7</span>
            <ul className="lobby-slots">
              {Array.from({ length: 7 }, (_, i) => {
                const p = screen.players[i]
                if (!p) {
                  return (
                    <li key={`empty-${i}`} className="lobby-slot lobby-slot-empty">
                      <span className="lobby-slot-num" aria-hidden="true">{SEAT_KANJI[i]}</span>
                      awaiting warrior…
                    </li>
                  )
                }
                return (
                  <li
                    key={p.seat}
                    className={`lobby-slot lobby-slot-filled ${p.connected ? '' : 'lobby-offline'}`}
                  >
                    <span className="lobby-slot-num" aria-hidden="true">{SEAT_KANJI[i]}</span>
                    <span className="lobby-slot-name">{p.name}</span>
                    {p.isHost && <span className="lobby-tag lobby-tag-host">host</span>}
                    {p.seat === screen.seat && <span className="lobby-tag lobby-tag-you">you</span>}
                    {!p.connected && <span className="lobby-offline-tag">offline</span>}
                  </li>
                )
              })}
            </ul>
            {session.startGame ? (
              <div className="lobby-begin-wrap">
                <button
                  className="btn btn-primary lobby-begin"
                  disabled={screen.players.length < 3}
                  onClick={() => session.startGame!()}
                >
                  Begin the duel
                </button>
                {screen.players.length < 3 ? (
                  <p className="lobby-begin-hint pulse">
                    A duel needs at least 3 warriors — awaiting{' '}
                    {3 - screen.players.length === 1 ? 'one more' : `${3 - screen.players.length} more`}…
                  </p>
                ) : (
                  <p className="lobby-begin-hint lobby-begin-ready">
                    {screen.players.length} warriors stand ready.
                  </p>
                )}
              </div>
            ) : (
              <p className="lobby-waiting pulse">Waiting for the host to begin…</p>
            )}
          </div>
          <button className="btn btn-ghost" onClick={leave}>Leave</button>
        </div>
      )}

      {screen.s === 'game' && view && session && (
        <GameScreen view={view} session={session} onLeave={leave} />
      )}
    </div>
  )
}

/** QR for the invite link — phones scan it straight into the room. */
function JoinQr(props: { code: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const url = `${location.origin}${location.pathname}?join=${props.code}`
    import('qrcode')
      .then((m) =>
        m.toDataURL(url, {
          margin: 1,
          width: 264,
          color: { dark: '#211c16', light: '#f2e8cf' },
        }),
      )
      .then((data) => {
        if (alive) setSrc(data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [props.code])
  if (!src) return null
  return (
    <div className="lobby-qr">
      <img src={src} alt={`QR code to join room ${props.code}`} width={132} height={132} />
      <span className="lobby-qr-hint">scan to join</span>
    </div>
  )
}

/** Shared SVG filter defs (card frames etc. reference #rough-ink on every screen). */
function SharedFilterDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="rough-ink" x="-8%" y="-8%" width="116%" height="116%">
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="2" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

/** Night scene behind the lobby/connecting/game screens. All code-generated. */
function SceneBackdrop() {
  return (
    <>
      <div className="scene" aria-hidden="true">
        <div className="scene-sky" />
        <div className="scene-moon" />
        <svg className="scene-mountains" viewBox="0 0 1200 260" preserveAspectRatio="none">
          <path
            d="M0 260 L0 190 Q120 130 240 175 Q330 205 420 160 Q540 100 660 165 Q760 200 870 150 Q1000 95 1100 160 L1200 190 L1200 260 Z"
            fill="#0d0f16" opacity="0.85"
          />
          <path
            d="M0 260 L0 225 Q160 175 320 215 Q470 250 620 205 Q790 155 940 210 Q1080 250 1200 215 L1200 260 Z"
            fill="#141018" opacity="0.7"
          />
        </svg>
        <div className="scene-grade" />
      </div>
    </>
  )
}
