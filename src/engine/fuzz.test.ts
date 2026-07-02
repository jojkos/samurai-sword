import { describe, expect, it } from 'vitest'
import { CARD_DEFS, CHARACTERS } from './cards'
import { applyIntent, createGame, RuleError } from './game'
import type { Card, GameState, Intent } from './types'

/**
 * Fuzz: play full random games and assert the engine never corrupts state,
 * never deadlocks, and always terminates.
 */

function mulberry(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function totalCards(state: GameState): number {
  return (
    state.deck.length +
    state.discard.length +
    state.players.reduce((sum, p) => sum + p.hand.length + p.properties.length, 0)
  )
}

function checkInvariants(state: GameState) {
  expect(totalCards(state)).toBe(90)
  for (const p of state.players) {
    expect(p.resilience).toBeGreaterThanOrEqual(0)
    expect(p.resilience).toBeLessThanOrEqual(CHARACTERS[p.character].resilience)
    expect(p.honor).toBeGreaterThanOrEqual(0)
    if (state.phase !== 'ended') expect(p.honor === 0).toBe(false)
  }
}

/** Produce a random plausible intent for whoever must act. */
function randomIntent(state: GameState, rand: () => number): { seat: number; intent: Intent } {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const pending = state.pending
  if (pending) {
    const seat = pending.type === 'forced' ? pending.queue[0] : pending.seat
    const p = state.players[seat]
    const weapons = p.hand.filter((c) => CARD_DEFS[c.kind].type === 'weapon')
    const parries = p.hand.filter((c) => c.kind === 'parry')
    switch (pending.type) {
      case 'parry': {
        const options: (Card | null)[] = [null, ...parries]
        if (p.character === 'hanzo' && p.hand.length >= 2) options.push(...weapons)
        return { seat, intent: { t: 'respondParry', card: pick(options)?.id ?? null } }
      }
      case 'forced': {
        const usable = pending.kind === 'jiujitsu' ? weapons
          : p.character === 'hanzo' && p.hand.length >= 2 ? [...parries, ...weapons] : parries
        const options: (Card | null)[] = [null, ...usable]
        return { seat, intent: { t: 'respondForced', card: pick(options)?.id ?? null } }
      }
      case 'bushido': {
        if (weapons.length > 0 && rand() < 0.7) {
          return { seat, intent: { t: 'respondBushido', discardWeapon: pick(weapons).id } }
        }
        return { seat, intent: { t: 'respondBushido', loseHonor: true } }
      }
      case 'ieyasu':
        return { seat, intent: { t: 'respondIeyasu', fromDiscard: rand() < 0.5 } }
      case 'discard': {
        const shuffled = [...p.hand].sort(() => rand() - 0.5)
        return { seat, intent: { t: 'respondDiscard', cards: shuffled.slice(0, pending.count).map((c) => c.id) } }
      }
    }
  }
  // turn player: random card with random target, sometimes end turn
  const seat = state.turnSeat
  const p = state.players[seat]
  if (rand() < 0.25 || p.hand.length === 0) return { seat, intent: { t: 'endTurn' } }
  if (p.character === 'nobunaga' && p.resilience >= 2 && rand() < 0.1) {
    return { seat, intent: { t: 'nobunaga' } }
  }
  const card = pick(p.hand)
  const def = CARD_DEFS[card.kind]
  const target = Math.floor(rand() * state.playerCount)
  if (def.type === 'weapon') return { seat, intent: { t: 'playWeapon', card: card.id, target } }
  if (def.type === 'property') return { seat, intent: { t: 'playProperty', card: card.id, target } }
  const withProp = state.players[target]?.properties.length > 0 && rand() < 0.5
  return {
    seat,
    intent: {
      t: 'playAction',
      card: card.id,
      target,
      ...(card.kind === 'geisha' && withProp
        ? { propertyCard: state.players[target].properties[0].id }
        : {}),
    },
  }
}

describe('fuzz: full random games', () => {
  it('plays 150 games to completion across all player counts without corruption', () => {
    let finished = 0
    for (let g = 0; g < 150; g++) {
      const n = 3 + (g % 5)
      const rand = mulberry(g * 7919 + 13)
      let state = createGame({
        names: Array.from({ length: n }, (_, i) => `P${i}`),
        seed: g * 31 + 1,
      })
      let illegalStreak = 0
      let steps = 0
      for (; steps < 8000 && state.phase !== 'ended'; steps++) {
        const { seat, intent } = randomIntent(state, rand)
        try {
          state = applyIntent(state, seat, intent)
          illegalStreak = 0
          if (steps % 25 === 0) checkInvariants(state)
        } catch (e) {
          if (!(e instanceof RuleError)) throw e
          if (++illegalStreak > 300) {
            // no legal random move found in 300 tries — force end turn if possible
            state = applyIntent(state, state.turnSeat, { t: 'endTurn' })
            illegalStreak = 0
          }
        }
      }
      expect(state.phase, `game ${g} (${n}p) should end (steps=${steps})`).toBe('ended')
      expect(state.result).not.toBeNull()
      checkInvariants(state)
      finished++
    }
    expect(finished).toBe(150)
  }, 60_000)
})
