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
      if ((e.target as HTMLElement).closest?.('.btn')) sound.uiClick()
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
    if (!name.trim()) return setError('First tell us your name, warrior.')
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
    if (!name.trim()) return setError('First tell us your name, warrior.')
    if (joinCode.trim().length < 4) return setError('Enter the 4-letter room code.')
    rememberName()
    setDead(null)
    const session = new GuestSession(joinCode.trim(), name.trim(), events())
    sessionRef.current = session
    setScreen({ s: 'connecting', code: session.code })
  }

  function leave() {
    // a deliberate exit from the lobby/game closes the room for good; cancelling
    // a connection attempt keeps the save so a reload can still resume it
    if (sessionRef.current instanceof HostSession && screen.s !== 'connecting') clearHostSave()
    sessionRef.current?.close()
    sessionRef.current = null
    setView(null)
    setDead(null)
    setScreen({ s: 'home' })
  }

  const session = sessionRef.current

  return (
    <div className="app">
      <SceneBackdrop />
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
        <div className="home">
          <h1 className="home-title">
            <span className="home-kanji">侍</span>
            <span className="home-name">Samurai Sword</span>
            <span className="home-subtitle">刀 · The Way of Honor</span>
          </h1>
          <p className="home-sub">A card game of hidden roles and stolen honor — 3 to 7 warriors, online.</p>
          <div className="home-panel">
            <label className="home-label" htmlFor="warrior-name">Your name, warrior</label>
            <input
              id="warrior-name"
              className="input"
              placeholder="e.g. Musashi"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="home-columns">
              <div className="home-column">
                <span className="home-label">Gather your clan</span>
                <button className="btn btn-primary" onClick={createRoom}>Create a room</button>
              </div>
              <div className="home-divider"><span>or</span></div>
              <div className="home-column">
                <span className="home-label">Answer the call</span>
                <div className="home-join">
                  <input
                    className="input input-code"
                    placeholder="CODE"
                    maxLength={4}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                  />
                  <button className="btn" onClick={joinRoom}>Join</button>
                </div>
              </div>
            </div>
            {hostSave && (
              <button className="btn btn-ghost" onClick={resumeRoom}>
                ⟲ Resume hosting room {hostSave.code}
                {hostSave.state ? ' (game in progress)' : ''}
              </button>
            )}
          </div>
          <p className="home-note">
            One player creates a room and shares its code. Everyone connects directly to the
            host&apos;s browser — no accounts, nothing to install. Keep the host tab open.
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
            <span className="home-label">Room code — share it with your clan</span>
            <div className="lobby-code">
              <strong className="lobby-code-hero">{screen.code}</strong>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => navigator.clipboard?.writeText(`${location.origin}${location.pathname}?join=${screen.code}`)}
                title="Copy invite link"
              >
                copy link
              </button>
            </div>
            <JoinQr code={screen.code} />
            <span className="home-label">Warriors {screen.players.length}/7</span>
            <ul className="lobby-slots">
              {Array.from({ length: 7 }, (_, i) => {
                const p = screen.players[i]
                if (!p) {
                  return (
                    <li key={`empty-${i}`} className="lobby-slot lobby-slot-empty">
                      awaiting warrior…
                    </li>
                  )
                }
                return (
                  <li
                    key={p.seat}
                    className={`lobby-slot lobby-slot-filled ${p.connected ? '' : 'lobby-offline'}`}
                  >
                    <span className="lobby-slot-name">{p.name}</span>
                    {p.isHost && <span className="lobby-tag lobby-tag-host">host</span>}
                    {p.seat === screen.seat && <span className="lobby-tag lobby-tag-you">you</span>}
                    {!p.connected && <span className="lobby-offline-tag">offline</span>}
                  </li>
                )
              })}
            </ul>
            {session.startGame ? (
              screen.players.length < 3 ? (
                <p className="lobby-waiting pulse">
                  Awaiting more warriors… ({screen.players.length}/3 minimum)
                </p>
              ) : (
                <button className="btn btn-primary lobby-begin" onClick={() => session.startGame!()}>
                  Begin the duel ({screen.players.length} players)
                </button>
              )
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

/** Night scene behind everything + shared SVG filter defs. All code-generated. */
function SceneBackdrop() {
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="rough-ink" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="2" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
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
