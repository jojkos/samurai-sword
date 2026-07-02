import { useEffect, useRef, useState } from 'react'
import type { PlayerView } from '../engine/types'
import { clearHostSave, GuestSession, HostSession, loadHostSave, Session } from '../net/session'
import type { LobbyPlayer } from '../net/protocol'
import { GameScreen } from './GameScreen'

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
  const sessionRef = useRef<Session | null>(null)
  const hostSave = loadHostSave()

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 4000)
      return () => clearTimeout(t)
    }
  }, [error])

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
    sessionRef.current?.close()
    sessionRef.current = null
    setView(null)
    setDead(null)
    setScreen({ s: 'home' })
  }

  const session = sessionRef.current

  return (
    <div className="app">
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
            Samurai Sword
          </h1>
          <p className="home-sub">The card game of honor and hidden roles — 3 to 7 players, online.</p>
          <div className="home-panel">
            <input
              className="input"
              placeholder="Your name"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="home-actions">
              <button className="btn btn-primary" onClick={createRoom}>Create room</button>
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
            {hostSave?.state && (
              <button className="btn btn-ghost" onClick={resumeRoom}>
                Resume room {hostSave.code} (game in progress)
              </button>
            )}
          </div>
          <p className="home-note">
            One player creates a room and shares the code. Everyone connects directly to the
            host&apos;s browser — keep the host tab open.
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
          <div className="lobby-code">
            Room code: <strong>{screen.code}</strong>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => navigator.clipboard?.writeText(`${location.origin}${location.pathname}?join=${screen.code}`)}
              title="Copy invite link"
            >
              copy link
            </button>
          </div>
          <ul className="lobby-list">
            {screen.players.map((p) => (
              <li key={p.seat} className={p.connected ? '' : 'lobby-offline'}>
                {p.name} {p.isHost && <em>(host)</em>} {p.seat === screen.seat && <em>(you)</em>}
                {!p.connected && ' — offline'}
              </li>
            ))}
          </ul>
          {session.startGame ? (
            <button
              className="btn btn-primary"
              disabled={screen.players.length < 3}
              onClick={() => session.startGame!()}
            >
              {screen.players.length < 3
                ? `Waiting for players (${screen.players.length}/3 minimum)`
                : `Begin the duel (${screen.players.length} players)`}
            </button>
          ) : (
            <p className="pulse">Waiting for the host to begin…</p>
          )}
          <button className="btn btn-ghost" onClick={leave}>Leave</button>
        </div>
      )}

      {screen.s === 'game' && view && session && (
        <GameScreen view={view} session={session} onLeave={leave} />
      )}
    </div>
  )
}
