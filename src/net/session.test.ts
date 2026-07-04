import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('peerjs', () => import('./fakePeer'))

import Peer, { FakeConn } from './fakePeer'
import { createGame } from '../engine/game'
import { GuestSession, HostSession } from './session'
import type { HostSave, SessionEvents } from './session'
import type { HostMsg, LobbyPlayer } from './protocol'
import type { PlayerView } from '../engine/types'

function collector() {
  const c = {
    lobbies: [] as LobbyPlayer[][],
    views: [] as PlayerView[],
    errors: [] as string[],
    dead: [] as string[],
  }
  const events: SessionEvents = {
    onLobby: (players) => c.lobbies.push(players),
    onView: (v) => c.views.push(v),
    onError: (m) => c.errors.push(m),
    onDead: (m) => c.dead.push(m),
  }
  return { ...c, events, lastLobby: () => c.lobbies[c.lobbies.length - 1] }
}

function makeHost(resume?: HostSave) {
  const ev = collector()
  const host = new HostSession('Hoster', ev.events, resume)
  const peer = Peer.instances[Peer.instances.length - 1]
  peer.emit('open')
  return { host, peer, ev }
}

/** Simulate a guest browser connecting and saying hello. */
function join(peer: Peer, name: string, token: string): FakeConn {
  const conn = new FakeConn()
  peer.emit('connection', conn)
  conn.emit('data', { t: 'hello', name, token })
  return conn
}

const sentOfType = (conn: FakeConn, t: HostMsg['t']) =>
  conn.sent.filter((m) => (m as HostMsg).t === t) as HostMsg[]

beforeEach(() => {
  Peer.instances.length = 0
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('lobby membership', () => {
  it('a joining guest appears in the lobby, connected', () => {
    const { peer, ev } = makeHost()
    join(peer, 'Aya', 't-aya')
    expect(ev.lastLobby()).toHaveLength(2)
    expect(ev.lastLobby()[1]).toMatchObject({ name: 'Aya', connected: true })
  })

  it('a deliberate leave frees the seat before the game starts', () => {
    const { peer, ev } = makeHost()
    const aya = join(peer, 'Aya', 't-aya')
    const ben = join(peer, 'Ben', 't-ben')
    aya.emit('data', { t: 'leave' })
    expect(ev.lastLobby().map((p) => p.name)).toEqual(['Hoster', 'Ben'])
    // Ben was re-told his new seat after the shift
    const lobbyMsgs = sentOfType(ben, 'lobby')
    expect(lobbyMsgs[lobbyMsgs.length - 1]).toMatchObject({ yourSeat: 1 })
  })

  it('a silent disconnect is forgiven briefly, then the seat is freed', () => {
    const { peer, ev } = makeHost()
    const aya = join(peer, 'Aya', 't-aya')
    aya.emit('close')
    expect(ev.lastLobby()[1]).toMatchObject({ name: 'Aya', connected: false })
    vi.advanceTimersByTime(9000)
    expect(ev.lastLobby().map((p) => p.name)).toEqual(['Hoster'])
  })

  it('a reload within the grace window keeps the seat and the original name', () => {
    const { peer, ev } = makeHost()
    const aya = join(peer, 'Aya', 't-aya')
    aya.emit('close')
    vi.advanceTimersByTime(3000)
    join(peer, 'SomethingElse', 't-aya') // same token → same seat, name kept
    expect(ev.lastLobby()[1]).toMatchObject({ name: 'Aya', connected: true })
    vi.advanceTimersByTime(20000) // stale eviction must not fire on the reclaimed seat
    expect(ev.lastLobby()).toHaveLength(2)
  })

  it('the room caps at 7 players', () => {
    const { peer } = makeHost()
    for (let i = 1; i <= 6; i++) join(peer, `G${i}`, `t${i}`)
    const eighth = join(peer, 'TooMany', 't-late')
    expect(sentOfType(eighth, 'rejected')[0]).toMatchObject({
      reason: expect.stringContaining('full'),
    })
  })
})

describe('in-game lifecycle', () => {
  it('a mid-game disconnect keeps the seat; the token rejoins into the running game', () => {
    const { host, peer, ev } = makeHost()
    const aya = join(peer, 'Aya', 't-aya')
    join(peer, 'Ben', 't-ben')
    host.startGame()
    aya.emit('close')
    vi.advanceTimersByTime(60000) // no eviction once the game runs
    expect(ev.lastLobby().map((p) => p.name)).toEqual(['Hoster', 'Aya', 'Ben'])
    expect(ev.lastLobby()[1].connected).toBe(false)
    const back = join(peer, 'Aya', 't-aya')
    expect(sentOfType(back, 'view').length).toBeGreaterThan(0)
  })

  it('an unknown player cannot join a started game', () => {
    const { host, peer } = makeHost()
    join(peer, 'Aya', 't-aya')
    join(peer, 'Ben', 't-ben')
    host.startGame()
    const late = join(peer, 'Late', 't-late')
    expect(sentOfType(late, 'rejected')[0]).toMatchObject({
      reason: expect.stringContaining('started'),
    })
  })

  it('disconnected ghosts are not dealt into the game', () => {
    const { host, peer, ev } = makeHost()
    join(peer, 'Aya', 't-aya')
    join(peer, 'Ben', 't-ben')
    const gone = join(peer, 'Ghost', 't-ghost')
    gone.emit('close') // vanished, still within grace when the host hits start
    host.startGame()
    expect(ev.views[ev.views.length - 1].playerCount).toBe(3)
    expect(ev.views[ev.views.length - 1].players.map((p) => p.name)).toEqual([
      'Hoster',
      'Aya',
      'Ben',
    ])
  })

  it('refuses to start with fewer than 3 connected players', () => {
    const { host, peer, ev } = makeHost()
    const aya = join(peer, 'Aya', 't-aya')
    join(peer, 'Ben', 't-ben')
    aya.emit('data', { t: 'leave' })
    host.startGame()
    expect(ev.errors[ev.errors.length - 1]).toContain('at least 3')
    expect(ev.views).toHaveLength(0)
  })
})

describe('room shutdown & resume', () => {
  it('closing the room tells every guest immediately', () => {
    const { host, peer } = makeHost()
    const aya = join(peer, 'Aya', 't-aya')
    host.close()
    expect(sentOfType(aya, 'closed')[0]).toMatchObject({
      reason: expect.stringContaining('host closed'),
    })
    expect(peer.destroyed).toBe(true)
  })

  it('a resumed lobby keeps roster seats claimable by token', () => {
    const save: HostSave = {
      code: 'ABCD',
      roster: { tokens: ['host', 't-aya'], names: ['Hoster', 'Aya'] },
      state: null,
      savedAt: Date.now(),
    }
    const { peer, ev } = makeHost(save)
    expect(ev.lastLobby().map((p) => p.name)).toEqual(['Hoster', 'Aya'])
    expect(ev.lastLobby()[1].connected).toBe(false)
    join(peer, 'RenamedAya', 't-aya')
    expect(ev.lastLobby()[1]).toMatchObject({ name: 'Aya', connected: true })
  })
})

describe('bots', () => {
  it('the host can seat and dismiss bots in the lobby', () => {
    const { host, ev } = makeHost()
    host.addBot()
    host.addBot()
    expect(ev.lastLobby()).toHaveLength(3)
    expect(ev.lastLobby()[1]).toMatchObject({ isBot: true, connected: true })
    host.removeBot(1)
    expect(ev.lastLobby()).toHaveLength(2)
    expect(ev.lastLobby()[1].isBot).toBe(true)
  })

  it('removeBot never evicts a human seat', () => {
    const { host, peer, ev } = makeHost()
    join(peer, 'Aya', 't-aya')
    host.removeBot(1)
    expect(ev.lastLobby().map((p) => p.name)).toEqual(['Hoster', 'Aya'])
  })

  it('bots fill the 3-player minimum and survive the ghost sweep at start', () => {
    const { host, peer, ev } = makeHost()
    host.addBot()
    host.addBot()
    const ghost = join(peer, 'Ghost', 't-ghost')
    ghost.emit('close')
    host.startGame()
    const view = ev.views[ev.views.length - 1]
    expect(view.playerCount).toBe(3) // host + 2 bots, ghost dropped
  })

  it('one human + two bots: the bots play the whole duel to its end', () => {
    const { host, ev } = makeHost()
    host.botDelay = [0, 0]
    host.addBot()
    host.addBot()
    host.startGame()
    const lastView = () => ev.views[ev.views.length - 1]
    for (let step = 0; step < 6000 && !lastView().result; step++) {
      const v = lastView()
      if (v.prompt) {
        // the host answers any prompt with the safe minimal response
        switch (v.prompt.type) {
          case 'parry': host.sendIntent({ t: 'respondParry', card: null }); break
          case 'forced': host.sendIntent({ t: 'respondForced', card: null }); break
          case 'bushido': {
            const w = v.you.hand.find((c) => ['bokken', 'kiseru', 'bo', 'shuriken', 'kusarigama', 'nagayari', 'kanabo', 'naginata', 'daikyu', 'tanegashima', 'wakizashi', 'katana', 'nodachi'].includes(c.kind))
            host.sendIntent(w ? { t: 'respondBushido', discardWeapon: w.id } : { t: 'respondBushido', loseHonor: true })
            break
          }
          case 'ieyasu': host.sendIntent({ t: 'respondIeyasu', fromDiscard: false }); break
          case 'discard': host.sendIntent({ t: 'respondDiscard', cards: v.you.hand.slice(0, v.prompt.count).map((c) => c.id) }); break
        }
      } else if (v.turnSeat === 0) {
        host.sendIntent({ t: 'endTurn' })
      } else {
        vi.advanceTimersByTime(5) // a bot is "thinking"
      }
    }
    expect(lastView().result).not.toBeNull()
  }, 30_000)

  it('a resumed game picks the duel back up when a bot is to act', () => {
    const save: HostSave = {
      code: 'ABCD',
      roster: { tokens: ['host', 'bot:a', 'bot:b'], names: ['Hoster', 'Kaze 風', 'Yama 山'] },
      state: createGame({ names: ['Hoster', 'Kaze 風', 'Yama 山'], seed: 7 }),
      savedAt: Date.now(),
    }
    const { host, ev } = makeHost(save)
    // if the save happened to capture the human's turn, pass it to a bot
    if (ev.views[ev.views.length - 1].turnSeat === 0) host.sendIntent({ t: 'endTurn' })
    const before = ev.views.length
    vi.advanceTimersByTime(2000) // beyond the default thinking delay
    expect(ev.views.length).toBeGreaterThan(before)
    host.close()
  })
})

describe('guest side', () => {
  function makeGuest() {
    const ev = collector()
    const guest = new GuestSession('ABCD', 'Go', ev.events)
    const peer = Peer.instances[Peer.instances.length - 1]
    peer.emit('open') // triggers connect()
    const conn = peer.lastConn!
    conn.emit('open') // sends hello
    return { guest, peer, conn, ev }
  }

  it('says hello with a stable token, and leave on close()', () => {
    const { guest, conn } = makeGuest()
    expect(conn.sent[0]).toMatchObject({ t: 'hello', name: 'Go' })
    guest.close()
    expect(conn.sent[conn.sent.length - 1]).toEqual({ t: 'leave' })
  })

  it('a closed broadcast ends the session with the reason', () => {
    const { peer, conn, ev } = makeGuest()
    conn.emit('data', { t: 'closed', reason: 'The host closed the room.' })
    expect(ev.dead).toEqual(['The host closed the room.'])
    expect(peer.destroyed).toBe(true)
  })

  it('a rejection ends the session with the reason', () => {
    const { conn, ev } = makeGuest()
    conn.emit('data', { t: 'rejected', reason: 'The room is full (7 players max).' })
    expect(ev.dead[0]).toContain('full')
  })
})
