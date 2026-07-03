import { describe, expect, it } from 'vitest'
import { baseHonor, cardKindInText, showcaseFromLog } from './helpers'
import type { PlayerView } from '../engine/types'

const players = [
  { seat: 0, name: 'Jo' },
  { seat: 1, name: 'Jonas' }, // prefix collision with "Jo"
  { seat: 2, name: 'Katana' }, // a player named after a card
]

describe('showcaseFromLog', () => {
  it('parses a plain play line', () => {
    expect(
      showcaseFromLog('Jonas plays Diversion and steals a random card from Jo.', players),
    ).toEqual({ kind: 'diversion', actorSeat: 1, isAttack: false })
  })

  it('marks attacks and finds the weapon', () => {
    expect(showcaseFromLog('Jo attacks Jonas with Kiseru (2 wounds).', players)).toEqual({
      kind: 'kiseru',
      actorSeat: 0,
      isAttack: true,
    })
  })

  it('parries showcase the parry card', () => {
    expect(showcaseFromLog('Jonas parries with Parry!', players)).toEqual({
      kind: 'parry',
      actorSeat: 1,
      isAttack: false,
    })
  })

  it('the longest player name wins the prefix match', () => {
    expect(showcaseFromLog('Jonas plays Daimyo.', players)?.actorSeat).toBe(1)
  })

  it('a player named after a card is the actor, not the card', () => {
    expect(showcaseFromLog('Katana plays Geisha: Jo discards a random card.', players)).toEqual({
      kind: 'geisha',
      actorSeat: 2,
    isAttack: false,
    })
  })

  it('showcases the played card, not a later-mentioned one', () => {
    expect(showcaseFromLog('Jo plays Geisha: Jonas discards Bushido.', players)?.kind).toBe(
      'geisha',
    )
  })

  it('non-play lines do not showcase', () => {
    expect(showcaseFromLog('Jonas draws 2 cards.', players)).toBeNull()
    expect(showcaseFromLog('Jonas discards Katana.', players)).toBeNull()
    expect(showcaseFromLog('Jonas suffers 2 wounds.', players)).toBeNull()
    expect(showcaseFromLog('Jonas is defeated and gives 1 Honor to Jo!', players)).toBeNull()
    expect(
      showcaseFromLog('Bushido reveals Nodachi — a Weapon! Jonas must choose.', players),
    ).toBeNull()
    expect(showcaseFromLog("— Jonas's turn —", players)).toBeNull()
  })
})

describe('cardKindInText', () => {
  it('prefers the earliest mention, longer name on ties', () => {
    expect(cardKindInText('plays Battle Cry!')).toBe('battlecry')
    expect(cardKindInText('attacks with Bokken (1 wound).')).toBe('bokken')
  })
})

describe('baseHonor', () => {
  const mk = (playerCount: number, shogunSeat: number): PlayerView =>
    ({
      seat: 0,
      playerCount,
      you: { hand: [], role: shogunSeat === 0 ? 'shogun' : 'ninja1', team: 'x' },
      players: Array.from({ length: playerCount }, (_, seat) => ({
        seat,
        role: seat === shogunSeat ? 'shogun' : null,
      })),
    }) as unknown as PlayerView

  it('shogun: 5 honor (6 in 3p)', () => {
    expect(baseHonor(mk(5, 1), 1)).toBe(5)
    expect(baseHonor(mk(3, 1), 1)).toBe(6)
  })

  it('others: 3 honor up to 5 players, 4 from 6 players', () => {
    expect(baseHonor(mk(4, 0), 2)).toBe(3)
    expect(baseHonor(mk(5, 0), 2)).toBe(3)
    expect(baseHonor(mk(6, 0), 2)).toBe(4)
    expect(baseHonor(mk(7, 0), 2)).toBe(4)
    expect(baseHonor(mk(3, 1), 2)).toBe(3)
  })
})
