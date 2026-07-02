import Peer, { DataConnection } from 'peerjs'
import { applyIntent, createGame, RuleError } from '../engine/game'
import { viewFor } from '../engine/view'
import type { GameState, Intent, PlayerView } from '../engine/types'
import { newRoomCode, newToken, roomToPeerId } from './protocol'
import type { GuestMsg, HostMsg, LobbyPlayer } from './protocol'

// ---------------- shared session events ----------------

export interface SessionEvents {
  onLobby: (players: LobbyPlayer[], code: string, yourSeat: number) => void
  onView: (view: PlayerView) => void
  onError: (message: string) => void
  /** connection to the room lost / could not be established */
  onDead: (reason: string) => void
}

export interface Session {
  readonly code: string
  readonly seat: number
  sendIntent(intent: Intent): void
  /** host only */
  startGame?(): void
  /** host only: deal a fresh game with the same players */
  playAgain?(): void
  close(): void
}

// ---------------- host ----------------

interface Roster {
  /** token → seat */
  tokens: string[]
  names: string[]
}

interface HostSave {
  code: string
  roster: Roster
  state: GameState | null
}

const HOST_SAVE_KEY = 'samurai-sword-host'

export function loadHostSave(): HostSave | null {
  try {
    const raw = localStorage.getItem(HOST_SAVE_KEY)
    return raw ? (JSON.parse(raw) as HostSave) : null
  } catch {
    return null
  }
}

export function clearHostSave() {
  localStorage.removeItem(HOST_SAVE_KEY)
}

export class HostSession implements Session {
  readonly code: string
  readonly seat = 0
  private peer: Peer
  private roster: Roster
  private state: GameState | null
  /** seat → live connection (seat 0 = host, always null) */
  private conns: (DataConnection | null)[]
  private events: SessionEvents
  private hostName: string
  private closed = false

  constructor(hostName: string, events: SessionEvents, resume?: HostSave) {
    this.events = events
    this.hostName = hostName
    this.code = resume?.code ?? newRoomCode()
    this.roster = resume?.roster ?? { tokens: ['host'], names: [hostName] }
    this.state = resume?.state ?? null
    this.conns = this.roster.tokens.map(() => null)

    this.peer = new Peer(roomToPeerId(this.code))
    this.peer.on('open', () => {
      this.pushLobby()
      if (this.state) this.pushViews()
    })
    this.peer.on('connection', (conn) => this.onConnection(conn))
    this.peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'unavailable-id') {
        events.onDead('Room code already in use. Create the room again.')
      } else if (err.type === 'peer-unavailable') {
        // a guest vanished; ignore
      } else if (!this.closed) {
        events.onError(`Network: ${err.type ?? err.message}`)
      }
    })
    this.save()
  }

  get started(): boolean {
    return this.state !== null
  }

  private save() {
    const save: HostSave = { code: this.code, roster: this.roster, state: this.state }
    try {
      localStorage.setItem(HOST_SAVE_KEY, JSON.stringify(save))
    } catch { /* full/blocked storage is non-fatal */ }
  }

  private onConnection(conn: DataConnection) {
    conn.on('data', (data) => {
      const msg = data as GuestMsg
      if (msg.t === 'hello') this.handleHello(conn, msg)
      else if (msg.t === 'intent') this.handleIntent(conn, msg.intent)
    })
    conn.on('close', () => {
      const seat = this.conns.indexOf(conn)
      if (seat > 0) {
        this.conns[seat] = null
        this.pushLobby()
      }
    })
  }

  private handleHello(conn: DataConnection, msg: { name: string; token: string }) {
    let seat = this.roster.tokens.indexOf(msg.token)
    if (seat < 0) {
      if (this.state) {
        conn.send({ t: 'rejected', reason: 'This game has already started.' } satisfies HostMsg)
        return
      }
      if (this.roster.tokens.length >= 7) {
        conn.send({ t: 'rejected', reason: 'The room is full (7 players max).' } satisfies HostMsg)
        return
      }
      seat = this.roster.tokens.length
      this.roster.tokens.push(msg.token)
      this.roster.names.push(msg.name || `Player ${seat + 1}`)
      this.conns.push(null)
    } else if (msg.name) {
      this.roster.names[seat] = msg.name
    }
    this.conns[seat]?.close()
    this.conns[seat] = conn
    this.save()
    this.pushLobby()
    if (this.state) this.sendView(seat)
  }

  private handleIntent(conn: DataConnection, intent: Intent) {
    const seat = this.conns.indexOf(conn)
    if (seat <= 0 || !this.state) return
    this.applyFrom(seat, intent, (message) => conn.send({ t: 'error', message } satisfies HostMsg))
  }

  /** Host's own moves come through here too. */
  sendIntent(intent: Intent) {
    if (!this.state) return
    this.applyFrom(0, intent, (message) => this.events.onError(message))
  }

  private applyFrom(seat: number, intent: Intent, reportError: (msg: string) => void) {
    try {
      this.state = applyIntent(this.state!, seat, intent)
      this.save()
      this.pushViews()
    } catch (e) {
      if (e instanceof RuleError) reportError(e.message)
      else throw e
    }
  }

  playAgain() {
    if (!this.state?.result) return
    this.state = null
    this.startGame()
  }

  startGame() {
    if (this.state) return
    if (this.roster.names.length < 3) {
      this.events.onError('Samurai Sword needs at least 3 players.')
      return
    }
    this.state = createGame({
      names: this.roster.names,
      seed: (Math.random() * 0x7fffffff) | 0,
    })
    this.save()
    this.pushViews()
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.roster.names.map((name, seat) => ({
      seat,
      name,
      isHost: seat === 0,
      connected: seat === 0 || this.conns[seat] != null,
    }))
  }

  private pushLobby() {
    const players = this.lobbyPlayers()
    this.events.onLobby(players, this.code, 0)
    players.forEach((p) => {
      if (p.seat > 0) {
        this.conns[p.seat]?.send({ t: 'lobby', players, yourSeat: p.seat, code: this.code } satisfies HostMsg)
      }
    })
  }

  private pushViews() {
    if (!this.state) return
    this.events.onView(viewFor(this.state, 0))
    for (let seat = 1; seat < this.roster.tokens.length; seat++) {
      this.conns[seat]?.send({ t: 'view', view: viewFor(this.state, seat) } satisfies HostMsg)
    }
  }

  private sendView(seat: number) {
    if (!this.state) return
    if (seat === 0) this.events.onView(viewFor(this.state, 0))
    else this.conns[seat]?.send({ t: 'view', view: viewFor(this.state, seat) } satisfies HostMsg)
  }

  close() {
    this.closed = true
    this.peer.destroy()
  }
}

// ---------------- guest ----------------

const guestKey = (code: string) => `samurai-sword-guest-${code.toUpperCase()}`

export class GuestSession implements Session {
  readonly code: string
  seat = -1
  private peer: Peer
  private conn: DataConnection | null = null
  private events: SessionEvents
  private name: string
  private token: string
  private closed = false
  private retries = 0

  constructor(code: string, name: string, events: SessionEvents) {
    this.code = code.toUpperCase()
    this.name = name
    this.events = events
    const saved = localStorage.getItem(guestKey(this.code))
    this.token = saved ?? newToken()
    localStorage.setItem(guestKey(this.code), this.token)

    this.peer = new Peer()
    this.peer.on('open', () => this.connect())
    this.peer.on('error', (err: Error & { type?: string }) => {
      if (this.closed) return
      if (err.type === 'peer-unavailable') {
        if (this.retries === 0) {
          this.events.onDead('Room not found. Check the code — and that the host has the game open.')
        } else {
          this.scheduleReconnect()
        }
      } else {
        this.events.onError(`Network: ${err.type ?? err.message}`)
      }
    })
  }

  private connect() {
    if (this.closed) return
    const conn = this.peer.connect(roomToPeerId(this.code), { reliable: true })
    this.conn = conn
    conn.on('open', () => {
      this.retries = Math.max(this.retries, 1) // connected at least once
      conn.send({ t: 'hello', name: this.name, token: this.token } satisfies GuestMsg)
    })
    conn.on('data', (data) => {
      const msg = data as HostMsg
      switch (msg.t) {
        case 'lobby':
          this.seat = msg.yourSeat
          this.events.onLobby(msg.players, msg.code, msg.yourSeat)
          break
        case 'view':
          this.seat = msg.view.seat
          this.events.onView(msg.view)
          break
        case 'error':
          this.events.onError(msg.message)
          break
        case 'rejected':
          this.closed = true
          this.events.onDead(msg.reason)
          this.peer.destroy()
          break
      }
    })
    conn.on('close', () => this.scheduleReconnect())
  }

  private scheduleReconnect() {
    if (this.closed) return
    this.retries++
    if (this.retries > 40) {
      this.events.onDead('Lost connection to the host.')
      return
    }
    setTimeout(() => this.connect(), 2000)
  }

  sendIntent(intent: Intent) {
    this.conn?.send({ t: 'intent', intent } satisfies GuestMsg)
  }

  close() {
    this.closed = true
    this.peer.destroy()
  }
}
