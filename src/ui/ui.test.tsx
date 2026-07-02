import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { GameScreen } from './GameScreen'
import type { Card, CardKind, Pending, PlayerView, PublicPlayer } from '../engine/types'
import type { Session } from '../net/session'

/**
 * SSR smoke tests: every screen state (endgame overlay, all prompt modals)
 * must render without throwing. Guards the UI paths a live session
 * doesn't reach every game.
 */

let id = 1
const c = (kind: CardKind): Card => ({ id: id++, kind })

const fakeSession: Session = {
  code: 'TEST',
  seat: 0,
  sendIntent: () => {},
  startGame: () => {},
  playAgain: () => {},
  close: () => {},
}

function mkPlayers(): PublicPlayer[] {
  const chars = ['chiyome', 'ieyasu', 'hideyoshi', 'musashi', 'benkei'] as const
  return chars.map((character, seat) => ({
    seat,
    name: `P${seat}`,
    character,
    maxResilience: 4,
    resilience: seat === 2 ? 0 : 3,
    honor: 3,
    handCount: 4,
    properties: seat === 1 ? [c('armor'), c('bushido')] : [],
    harmless: seat === 2,
    role: seat === 0 ? 'shogun' : null,
  }))
}

function mkView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    seat: 0,
    playerCount: 5,
    you: { hand: [c('parry'), c('katana'), c('geisha'), c('bokken')], role: 'shogun', team: 'shogun' },
    players: mkPlayers(),
    deckCount: 40,
    discardTop: c('kanabo'),
    discardCount: 8,
    turnSeat: 0,
    phase: 'play',
    weaponsPlayed: 0,
    weaponsAllowed: 1,
    prompt: null,
    waitingFor: null,
    log: [{ n: 1, text: 'The game begins.' }],
    result: null,
    ...overrides,
  }
}

function render(view: PlayerView): string {
  return renderToString(<GameScreen view={view} session={fakeSession} onLeave={() => {}} />)
}

describe('GameScreen SSR smoke', () => {
  it('renders the plain table', () => {
    const html = render(mkView())
    expect(html).toContain('End turn')
    expect(html).toContain('P0')
  })

  it('renders every prompt modal', () => {
    const prompts: Pending[] = [
      { type: 'parry', seat: 0, attackerSeat: 1, weaponCard: c('katana'), damage: 3 },
      { type: 'forced', kind: 'battlecry', sourceSeat: 1, queue: [0], card: c('battlecry') },
      { type: 'forced', kind: 'jiujitsu', sourceSeat: 1, queue: [0], card: c('jiujitsu') },
      { type: 'bushido', seat: 0, flipped: c('nodachi') },
      { type: 'ieyasu', seat: 0 },
      { type: 'discard', seat: 0, count: 2 },
    ]
    for (const prompt of prompts) {
      const html = render(mkView({ prompt }))
      expect(html).toContain('modal')
    }
  })

  it('renders the waiting banner when someone else must respond', () => {
    const html = render(mkView({
      prompt: null,
      waitingFor: 3,
    }))
    expect(html).toMatch(/Waiting for.*P3/)
  })

  it('renders the scored endgame overlay with team breakdown', () => {
    const html = render(mkView({
      phase: 'ended',
      result: {
        type: 'scored',
        winnerTeam: 'ninja',
        teams: [
          {
            team: 'shogun', total: 7, penalty: 0,
            members: [
              { seat: 0, role: 'shogun', honor: 3, multiplier: 1, daimyo: 1, score: 4 },
              { seat: 1, role: 'samurai1', honor: 1, multiplier: 2, daimyo: 0, score: 2 },
            ],
          },
          {
            team: 'ninja', total: 8, penalty: 0,
            members: [
              { seat: 2, role: 'ninja1', honor: 4, multiplier: 1, daimyo: 0, score: 4 },
              { seat: 3, role: 'ninja3', honor: 4, multiplier: 1, daimyo: 0, score: 4 },
            ],
          },
          {
            team: 'ronin', total: 6, penalty: 3,
            members: [{ seat: 4, role: 'ronin', honor: 3, multiplier: 3, daimyo: 0, score: 9 }],
          },
        ],
      },
    }))
    expect(html).toContain('Ninja')
    expect(html).toContain('mortal blow')
    expect(html).toContain('Play again')
  })

  it('renders the sword master victory overlay', () => {
    const html = render(mkView({
      phase: 'ended',
      result: {
        type: 'swordmaster',
        winnerTeam: 'shogun',
        swordmasterSeat: 0,
        teams: [],
      },
    }))
    expect(html).toContain('Sword Master')
    expect(html).toContain('stood alone')
  })
})
