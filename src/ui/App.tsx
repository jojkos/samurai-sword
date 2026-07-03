import { useCallback, useEffect, useRef, useState } from 'react'
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
  // one-shot dusk veil that falls when the daylight lobby gives way to the night duel
  const [duskFall, setDuskFall] = useState(false)
  // inline field affordance mirroring the error toast (name / room code)
  const [fieldError, setFieldError] = useState<{ field: 'name' | 'code'; msg: string } | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef<Session | null>(null)
  const hostSave = loadHostSave()
  // always-current screen, so the once-registered popstate handler isn't stale
  const screenRef = useRef(screen)
  screenRef.current = screen

  /** Close the session and return home WITHOUT touching history (used by both the
   * Leave button and the browser Back button). */
  const teardown = useCallback(() => {
    // cancelling during 'connecting' keeps the host save so a reload can resume
    if (sessionRef.current instanceof HostSession && screenRef.current.s !== 'connecting') {
      clearHostSave()
    }
    sessionRef.current?.close()
    sessionRef.current = null
    setView(null)
    setDead(null)
    setCopied(false)
    setScreen({ s: 'home' })
  }, [])

  /** Reflect "in a room" in the URL as its own history entry, so browser Back
   * pops out of the room. pushState keeps the in-memory PeerJS session alive
   * (no reload), so navigation never drops the connection. */
  function pushRoomUrl(code: string) {
    try {
      history.pushState({ inRoom: true, code }, '', `?room=${code}`)
    } catch {
      /* history unavailable — non-fatal */
    }
  }

  // Back/forward: leaving the room entry tears the session down; going forward
  // into a room already left just keeps the URL honest (can't resurrect it).
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const inRoom = !!(e.state && (e.state as { inRoom?: boolean }).inRoom)
      if (!inRoom && sessionRef.current) {
        teardown()
      } else if (inRoom && !sessionRef.current) {
        try {
          history.replaceState({ inRoom: false }, '', location.pathname)
        } catch { /* non-fatal */ }
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [teardown])

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
      if ((e.target as HTMLElement).closest?.('.btn, .ink-seal, .ink-resume, .ink-ghost, .ink-copy'))
        sound.uiClick()
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

  // entering the duel — the daylight ink world dissolves into night (see .ink-dusk).
  // keyed on screen.s so mid-game view updates (which keep s==='game') don't retrigger it.
  const prevScreen = useRef(screen.s)
  useEffect(() => {
    const was = prevScreen.current
    prevScreen.current = screen.s
    if (screen.s === 'game' && was !== 'game') {
      setDuskFall(true)
      const t = setTimeout(() => setDuskFall(false), 1150)
      return () => clearTimeout(t)
    }
  }, [screen.s])

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
      pushRoomUrl(session.code)
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
    pushRoomUrl(session.code)
  }

  function resumeRoom() {
    const save = loadHostSave()
    if (!save) return
    setDead(null)
    const session = new HostSession(save.roster.names[0], events(), save)
    sessionRef.current = session
    setScreen({ s: 'connecting', code: session.code })
    pushRoomUrl(session.code)
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
    pushRoomUrl(session.code)
  }

  function copyInvite(code: string) {
    navigator.clipboard?.writeText(`${location.origin}${location.pathname}?join=${code}`)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  function leave() {
    teardown()
    // record the return-home as its own history entry (Back from here won't re-enter)
    try {
      history.pushState({ inRoom: false }, '', location.pathname)
    } catch { /* non-fatal */ }
  }

  const session = sessionRef.current
  // home, connecting and lobby all live in the daylight ink painting; only the duel
  // itself moves to night. the daylight→night swap is masked by a one-shot dusk veil.
  const inkWorld = screen.s === 'home' || screen.s === 'connecting' || screen.s === 'lobby'

  return (
    <div className={inkWorld ? 'app app-ink' : 'app'}>
      <SharedFilterDefs />
      {inkWorld ? <InkScene /> : <SceneBackdrop />}
      {duskFall && <div className="ink-dusk" aria-hidden="true" />}
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
        <svg viewBox="0 0 24 24" className="sound-icon" aria-hidden="true">
          <path d="M4 9 H7 L12 5 V19 L7 15 H4 Z" />
          {soundOn ? (
            <>
              <path className="sound-wave" d="M15.5 8.5 A5 5 0 0 1 15.5 15.5" />
              <path className="sound-wave" d="M17.8 6 A8.5 8.5 0 0 1 17.8 18" />
            </>
          ) : (
            <path className="sound-x" d="M16 9 L21 15 M21 9 L16 15" />
          )}
        </svg>
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
        <div className="ink-connecting">
          {/* the torii — a threshold painting itself while the browsers find each
              other, a paper lantern lit at its heart as the thread binds. the gate
              foreshadows the dusk-fall: cross it and the duel begins at night. */}
          <div className="ink-torii-scene" aria-hidden="true">
            <div className="ink-torii-glow" />
            <svg className="ink-torii" viewBox="0 0 240 210" preserveAspectRatio="xMidYMax meet">
              {/* stepping stones approaching the gate */}
              <g className="ink-torii-path" fill="#4a4238">
                <ellipse className="ink-torii-stone" cx="120" cy="200" rx="20" ry="5" opacity="0.5" />
                <ellipse className="ink-torii-stone" cx="120" cy="182" rx="13" ry="3.5" opacity="0.4" />
                <ellipse className="ink-torii-stone" cx="120" cy="169" rx="8" ry="2.4" opacity="0.32" />
              </g>
              {/* pillars, leaning subtly inward */}
              <path
                className="ink-torii-stroke ink-torii-p1" pathLength="1"
                d="M60 188 L67 54" fill="none" stroke="#26211a" strokeWidth="8" strokeLinecap="round"
              />
              <path
                className="ink-torii-stroke ink-torii-p2" pathLength="1"
                d="M180 188 L173 54" fill="none" stroke="#26211a" strokeWidth="8" strokeLinecap="round"
              />
              {/* nuki — the tie beam */}
              <path
                className="ink-torii-stroke ink-torii-nuki" pathLength="1"
                d="M50 96 L190 96" fill="none" stroke="#26211a" strokeWidth="7" strokeLinecap="round"
              />
              {/* gakuzuka — the short centre post carrying the lantern */}
              <path
                className="ink-torii-stroke ink-torii-post" pathLength="1"
                d="M120 66 L120 96" fill="none" stroke="#26211a" strokeWidth="4" strokeLinecap="round"
              />
              {/* shimaki — the straight second beam */}
              <path
                className="ink-torii-stroke ink-torii-shimaki" pathLength="1"
                d="M40 66 L200 66" fill="none" stroke="#26211a" strokeWidth="7" strokeLinecap="round"
              />
              {/* kasagi — the crowning beam, upturned at the ends (sori) */}
              <path
                className="ink-torii-stroke ink-torii-kasagi" pathLength="1"
                d="M28 50 Q120 62 212 50" fill="none" stroke="#26211a" strokeWidth="9" strokeLinecap="round"
              />
            </svg>
            {/* the paper lantern (chōchin), lit as the connection binds */}
            <div className="ink-lantern">
              <span className="ink-lantern-kanji">刀</span>
            </div>
            {/* embers rising from the lantern — quiet, looping proof of life */}
            <span className="ink-spark ink-spark-1" />
            <span className="ink-spark ink-spark-2" />
            <span className="ink-spark ink-spark-3" />
          </div>
          <p className="ink-connecting-eyebrow">門 · Crossing the threshold</p>
          <h2 className="ink-connecting-title">
            Opening room <strong className="ink-connecting-code">{screen.code}</strong>
          </h2>
          <p className="ink-connecting-sub pulse">binding the thread between browsers…</p>
          <button className="ink-ghost" onClick={leave}>Cancel</button>
        </div>
      )}

      {screen.s === 'lobby' && session && (
        <div className="ink-lobby">
          <header className="ink-lobby-head">
            <h1 className="ink-lobby-title">
              <span className="ink-lobby-kanji" aria-hidden="true">集</span>
              The Clan Gathers
            </h1>
            {/* one brushed rule cut beneath the heading, echoing the home slash */}
            <svg className="ink-lobby-rule" viewBox="0 0 420 20" preserveAspectRatio="none" aria-hidden="true">
              <path
                className="ink-lobby-rule-stroke" pathLength="1"
                d="M8 13 Q140 5 250 10 Q340 14 412 7"
                fill="none" stroke="#c3282f" strokeWidth="6" strokeLinecap="round"
              />
            </svg>
            <p className="ink-lobby-sub">招 · Summon your clan, then take the field</p>
          </header>

          {/* the summons — a painted proclamation */}
          <section className="ink-panel ink-summons">
            <span className="ink-label ink-label-center">The room code</span>
            <div className="ink-summons-row">
              <div className="ink-summons-code">
                <div className="ink-code-plate">
                  <svg className="ink-code-frame" viewBox="0 0 260 100" preserveAspectRatio="none" aria-hidden="true">
                    <rect className="ink-code-frame-stroke" pathLength="1" x="5" y="5" width="250" height="90" rx="9" fill="none" strokeWidth="3" />
                  </svg>
                  <strong className="ink-code-hero">{screen.code}</strong>
                </div>
                <span className="ink-summons-hint">speak the code, or share the link</span>
                <button
                  className={`ink-copy ${copied ? 'ink-copy-done' : ''}`}
                  onClick={() => copyInvite(screen.code)}
                  title="Copy invite link"
                  aria-live="polite"
                >
                  <span className="ink-copy-kanji" aria-hidden="true">{copied ? '✓' : '写'}</span>
                  {copied ? 'link copied' : 'copy invite link'}
                </button>
              </div>
              <JoinQr code={screen.code} />
            </div>
          </section>

          {/* the roster — each arrival brushed onto its name plate */}
          <section className="ink-panel ink-roster">
            <span className="ink-label ink-label-center">Warriors · {screen.players.length}/7</span>
            <ul className="ink-seats">
              {Array.from({ length: 7 }, (_, i) => {
                const p = screen.players[i]
                if (!p) {
                  return (
                    <li key={`empty-${i}`} className="ink-seat ink-seat-empty">
                      <span className="ink-seat-await">awaiting warrior…</span>
                    </li>
                  )
                }
                return (
                  <li
                    key={p.seat}
                    className={`ink-seat ink-seat-filled ${p.connected ? '' : 'ink-seat-offline'}`}
                  >
                    <span className="ink-seat-name">{p.name}</span>
                    {p.isHost && <span className="ink-seat-tag ink-seat-tag-host">host</span>}
                    {p.seat === screen.seat && <span className="ink-seat-tag ink-seat-tag-you">you</span>}
                    {!p.connected && <span className="ink-seat-offline-tag">offline</span>}
                    {/* the brush stroke that writes the warrior onto the roster */}
                    <svg className="ink-seat-brush" viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden="true">
                      <path
                        className="ink-seat-brush-stroke" pathLength="1"
                        d="M4 6 Q90 2 160 5 Q230 8 296 4"
                        fill="none" stroke="#26211a" strokeWidth="2.5" strokeLinecap="round"
                      />
                    </svg>
                  </li>
                )
              })}
            </ul>
          </section>

          {session.startGame ? (
            <div className="ink-begin-wrap">
              <button
                className="ink-seal ink-seal-vermilion ink-begin"
                disabled={screen.players.length < 3}
                onClick={() => session.startGame!()}
              >
                <span className="ink-seal-kanji" aria-hidden="true">討</span>
                <span className="ink-seal-text">Begin the duel</span>
              </button>
              {screen.players.length < 3 ? (
                <p className="ink-begin-hint pulse">
                  A duel needs at least 3 warriors — awaiting{' '}
                  {3 - screen.players.length === 1 ? 'one more' : `${3 - screen.players.length} more`}…
                </p>
              ) : (
                <p className="ink-begin-hint ink-begin-ready">
                  {screen.players.length} warriors stand ready.
                </p>
              )}
            </div>
          ) : (
            <p className="ink-waiting pulse">Waiting for the host to begin…</p>
          )}

          <button className="ink-ghost" onClick={leave}>Leave the gathering</button>
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
    <div className="ink-qr">
      <img src={src} alt={`QR code to join room ${props.code}`} width={132} height={132} />
      <span className="ink-qr-hint">scan to join</span>
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
