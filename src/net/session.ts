import Peer, { DataConnection } from 'peerjs'
import { botIntent, pickBotName } from '../engine/bot'
import { cardDef } from '../engine/cards'
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
  /** host only, pre-game: seat a bot / dismiss a bot */
  addBot?(): void
  removeBot?(seat: number): void
  close(): void
}

/* Storage access that survives environments without Web Storage (tests, SSR). */
function ls(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}
function ss(): Storage | null {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

// ---------------- bots ----------------

/** Bot seats are ordinary roster entries whose token carries this prefix. */
const BOT_TOKEN_PREFIX = 'bot:'

export function isBotToken(token: string): boolean {
  return token.startsWith(BOT_TOKEN_PREFIX)
}

/** Whoever the engine is waiting on right now (prompt respondent, else turn player). */
function actingSeat(state: GameState): number {
  if (state.pending) {
    return state.pending.type === 'forced' ? state.pending.queue[0] : state.pending.seat
  }
  return state.turnSeat
}

/** An always-legal move, so a bot can never stall the table even if its policy slips. */
function fallbackIntent(state: GameState, seat: number): Intent {
  const pending = state.pending
  if (!pending) return { t: 'endTurn' }
  switch (pending.type) {
    case 'parry':
      return { t: 'respondParry', card: null }
    case 'forced':
      return { t: 'respondForced', card: null }
    case 'bushido': {
      const w = state.players[seat].hand.find((c) => cardDef(c).type === 'weapon')
      return w ? { t: 'respondBushido', discardWeapon: w.id } : { t: 'respondBushido', loseHonor: true }
    }
    case 'ieyasu':
      return { t: 'respondIeyasu', fromDiscard: false }
    case 'discard':
      return { t: 'respondDiscard', cards: state.players[seat].hand.slice(0, pending.count).map((c) => c.id) }
  }
}

// ---------------- host ----------------

interface Roster {
  /** token → seat */
  tokens: string[]
  names: string[]
}

export interface HostSave {
  code: string
  roster: Roster
  state: GameState | null
  savedAt?: number
}

const HOST_SAVE_KEY = 'samurai-sword-host'
/** a room older than this is not worth auto-resuming */
const HOST_SAVE_TTL = 12 * 60 * 60 * 1000
/** pre-game: how long a silently vanished guest keeps their seat */
const LOBBY_DISCONNECT_GRACE = 8000

export function loadHostSave(): HostSave | null {
  try {
    const raw = ls()?.getItem(HOST_SAVE_KEY)
    if (!raw) return null
    const save = JSON.parse(raw) as HostSave
    if (save.savedAt && Date.now() - save.savedAt > HOST_SAVE_TTL) {
      clearHostSave()
      return null
    }
    return save
  } catch {
    return null
  }
}

export function clearHostSave() {
  ls()?.removeItem(HOST_SAVE_KEY)
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
  /** token → pending pre-game removal timer */
  private evictions = new Map<string, ReturnType<typeof setTimeout>>()
  /** the one live "a bot is thinking" timer (only one seat can be to act) */
  private botTimer: ReturnType<typeof setTimeout> | null = null
  /** how long a bot pretends to think, ms (tests shrink this) */
  botDelay: [number, number] = [650, 1500]

  private idRetries = 0

  constructor(hostName: string, events: SessionEvents, resume?: HostSave) {
    this.events = events
    this.hostName = hostName
    this.code = resume?.code ?? newRoomCode()
    this.roster = resume?.roster ?? { tokens: ['host'], names: [hostName] }
    this.state = resume?.state ?? null
    this.conns = this.roster.tokens.map(() => null)
    this.peer = this.createPeer()
    this.save()
    // a resumed game may already be waiting on a bot — pick the duel back up
    this.scheduleBots()
  }

  private createPeer(): Peer {
    const peer = new Peer(roomToPeerId(this.code))
    peer.on('open', () => {
      this.idRetries = 0
      this.pushLobby()
      if (this.state) this.pushViews()
    })
    peer.on('connection', (conn) => this.onConnection(conn))
    peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'unavailable-id') {
        // After a reload the broker may hold our old registration for a few
        // seconds — retry before giving up.
        if (this.closed) return
        if (this.idRetries++ < 6) {
          setTimeout(() => {
            if (this.closed) return
            this.peer.destroy()
            this.peer = this.createPeer()
          }, 1500)
        } else {
          this.events.onDead(
            'This room is still open in another tab or device. Close the other host tab first — or just Join with the room code.',
          )
        }
      } else if (err.type === 'peer-unavailable') {
        // a guest vanished; ignore
      } else if (!this.closed) {
        this.events.onError(`Network: ${err.type ?? err.message}`)
      }
    })
    return peer
  }

  get started(): boolean {
    return this.state !== null
  }

  private save() {
    const save: HostSave = {
      code: this.code,
      roster: this.roster,
      state: this.state,
      savedAt: Date.now(),
    }
    try {
      ls()?.setItem(HOST_SAVE_KEY, JSON.stringify(save))
    } catch { /* full/blocked storage is non-fatal */ }
  }

  private onConnection(conn: DataConnection) {
    conn.on('data', (data) => {
      const msg = data as GuestMsg
      if (msg.t === 'hello') this.handleHello(conn, msg)
      else if (msg.t === 'intent') this.handleIntent(conn, msg.intent)
      else if (msg.t === 'leave') this.handleLeave(conn)
    })
    conn.on('close', () => this.handleDisconnect(conn))
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
    }
    // A known token keeps its original name — a rejoin never renames the seat.
    const pending = this.evictions.get(msg.token)
    if (pending) {
      clearTimeout(pending)
      this.evictions.delete(msg.token)
    }
    this.conns[seat]?.close()
    this.conns[seat] = conn
    this.save()
    this.pushLobby()
    if (this.state) this.sendView(seat)
  }

  /** Deliberate departure. Pre-game the seat is freed; mid-game it just goes offline. */
  private handleLeave(conn: DataConnection) {
    const seat = this.conns.indexOf(conn)
    if (seat <= 0) return
    this.conns[seat] = null
    if (!this.state) this.dropSeat(seat)
    this.pushLobby()
  }

  /** Connection died without a leave — reload, sleep, crash, or a real exit. */
  private handleDisconnect(conn: DataConnection) {
    const seat = this.conns.indexOf(conn)
    if (seat <= 0) return
    this.conns[seat] = null
    this.pushLobby()
    if (this.state) return // in-game seats survive; the token can always rejoin
    // pre-game: give reloads a grace window, then free the seat
    const token = this.roster.tokens[seat]
    const pending = this.evictions.get(token)
    if (pending) clearTimeout(pending)
    this.evictions.set(
      token,
      setTimeout(() => {
        this.evictions.delete(token)
        if (this.closed || this.state) return
        const s = this.roster.tokens.indexOf(token)
        if (s > 0 && !this.conns[s]) {
          this.dropSeat(s)
          this.pushLobby()
        }
      }, LOBBY_DISCONNECT_GRACE),
    )
  }

  /** Remove a pre-game seat entirely; later seats shift down (lobby pushes re-tell everyone their seat). */
  private dropSeat(seat: number) {
    const token = this.roster.tokens[seat]
    const pending = this.evictions.get(token)
    if (pending) {
      clearTimeout(pending)
      this.evictions.delete(token)
    }
    this.roster.tokens.splice(seat, 1)
    this.roster.names.splice(seat, 1)
    this.conns.splice(seat, 1)
    this.save()
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
      this.scheduleBots()
    } catch (e) {
      if (e instanceof RuleError) reportError(e.message)
      else throw e
    }
  }

  // ----- bots -----

  addBot() {
    if (this.state) return // seats are fixed once the duel begins
    if (this.roster.tokens.length >= 7) {
      this.events.onError('The room is full (7 players max).')
      return
    }
    this.roster.tokens.push(BOT_TOKEN_PREFIX + newToken())
    this.roster.names.push(pickBotName(this.roster.names))
    this.conns.push(null)
    this.save()
    this.pushLobby()
  }

  removeBot(seat: number) {
    if (this.state) return
    if (!isBotToken(this.roster.tokens[seat] ?? '')) return
    this.dropSeat(seat)
    this.pushLobby()
  }

  /** If the engine is waiting on a bot seat, let it "think" then act. */
  private scheduleBots() {
    if (this.botTimer) {
      clearTimeout(this.botTimer)
      this.botTimer = null
    }
    const state = this.state
    if (this.closed || !state || state.phase === 'ended') return
    const seat = actingSeat(state)
    if (!isBotToken(this.roster.tokens[seat])) return
    const [lo, hi] = this.botDelay
    this.botTimer = setTimeout(() => {
      this.botTimer = null
      this.actBot()
    }, lo + Math.random() * (hi - lo))
  }

  private actBot() {
    const state = this.state
    if (this.closed || !state || state.phase === 'ended') return
    const seat = actingSeat(state)
    if (!isBotToken(this.roster.tokens[seat])) return
    let next: GameState
    try {
      next = applyIntent(state, seat, botIntent(viewFor(state, seat)))
    } catch {
      // the policy slipped (illegal move or a bug) — make the always-legal
      // move instead so a bot can never stall the table
      next = applyIntent(state, seat, fallbackIntent(state, seat))
    }
    this.state = next
    this.save()
    this.pushViews()
    this.scheduleBots()
  }

  playAgain() {
    if (!this.state?.result) return
    this.state = null
    this.startGame()
  }

  startGame() {
    if (this.state) return
    // ghosts — joined then vanished pre-game — must not be dealt into the game
    // (bot seats have no connection by design and always stay)
    let dropped = false
    for (let seat = this.roster.tokens.length - 1; seat > 0; seat--) {
      if (!this.conns[seat] && !isBotToken(this.roster.tokens[seat])) {
        this.dropSeat(seat)
        dropped = true
      }
    }
    if (dropped) this.pushLobby()
    if (this.roster.names.length < 3) {
      this.events.onError('Samurai Sword needs at least 3 players — add bots to fill the seats.')
      return
    }
    this.state = createGame({
      names: this.roster.names,
      seed: (Math.random() * 0x7fffffff) | 0,
    })
    this.save()
    this.pushViews()
    this.scheduleBots()
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.roster.names.map((name, seat) => {
      const isBot = isBotToken(this.roster.tokens[seat])
      return {
        seat,
        name,
        isHost: seat === 0,
        isBot,
        connected: seat === 0 || isBot || this.conns[seat] != null,
      }
    })
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
    if (this.botTimer) clearTimeout(this.botTimer)
    this.botTimer = null
    this.evictions.forEach((t) => clearTimeout(t))
    this.evictions.clear()
    // tell everyone right away instead of letting them time out
    const closedMsg = { t: 'closed', reason: 'The host closed the room.' } satisfies HostMsg
    this.conns.forEach((c) => {
      try {
        c?.send(closedMsg)
      } catch { /* already gone */ }
    })
    this.peer.destroy()
  }
}

// ---------------- guest ----------------

const guestKey = (code: string) => `samurai-sword-guest-${code.toUpperCase()}`
const GUEST_ROOM_KEY = 'samurai-sword-guest-room'

/** a remembered room older than this is stale — do not drag players back in */
const GUEST_ROOM_TTL = 6 * 60 * 60 * 1000

/** The room this tab is (or was) sitting in — lets a reload rejoin automatically. */
export function loadGuestRoom(): { code: string; name: string } | null {
  try {
    const raw = ss()?.getItem(GUEST_ROOM_KEY)
    if (!raw) return null
    const room = JSON.parse(raw) as { code: string; name: string; savedAt?: number }
    if (room.savedAt && Date.now() - room.savedAt > GUEST_ROOM_TTL) {
      clearGuestRoom()
      return null
    }
    return room
  } catch {
    return null
  }
}

export function clearGuestRoom() {
  ss()?.removeItem(GUEST_ROOM_KEY)
}

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
    // sessionStorage: per-tab, so several guests can play from one browser;
    // still survives a reload of that tab (seat is reclaimed via the token).
    const saved = ss()?.getItem(guestKey(this.code))
    this.token = saved ?? newToken()
    ss()?.setItem(guestKey(this.code), this.token)
    ss()?.setItem(GUEST_ROOM_KEY, JSON.stringify({ code: this.code, name, savedAt: Date.now() }))

    this.peer = new Peer()
    this.peer.on('open', () => this.connect())
    this.peer.on('error', (err: Error & { type?: string }) => {
      if (this.closed) return
      if (err.type === 'peer-unavailable') {
        if (this.retries === 0) {
          this.die('Room not found. Check the code — and that the host has the game open.')
        } else {
          this.scheduleReconnect()
        }
      } else {
        this.events.onError(`Network: ${err.type ?? err.message}`)
      }
    })
  }

  private die(reason: string) {
    this.closed = true
    clearGuestRoom()
    this.events.onDead(reason)
    this.peer.destroy()
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
          this.die(msg.reason)
          break
        case 'closed':
          this.die(msg.reason)
          break
      }
    })
    conn.on('close', () => this.scheduleReconnect())
  }

  private scheduleReconnect() {
    if (this.closed) return
    this.retries++
    if (this.retries > 40) {
      this.die('Lost connection to the host.')
      return
    }
    setTimeout(() => this.connect(), 2000)
  }

  sendIntent(intent: Intent) {
    this.conn?.send({ t: 'intent', intent } satisfies GuestMsg)
  }

  close() {
    this.closed = true
    clearGuestRoom()
    // deliberate exit — free the seat instead of ghosting in the lobby
    try {
      this.conn?.send({ t: 'leave' } satisfies GuestMsg)
    } catch { /* already gone */ }
    this.peer.destroy()
  }
}
