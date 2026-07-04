import { describe, expect, it } from 'vitest'
import { botIntent } from './bot'
import { applyIntent, createGame } from './game'
import { viewFor } from './view'
import type { GameState } from './types'

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

/** Whoever must act right now (prompt respondent, else the turn player). */
function actingSeat(state: GameState): number {
  if (state.pending) {
    return state.pending.type === 'forced' ? state.pending.queue[0] : state.pending.seat
  }
  return state.turnSeat
}

describe('bot policy', () => {
  it('plays 100 full games through redacted views with zero illegal moves', () => {
    for (let g = 0; g < 100; g++) {
      const n = 3 + (g % 5)
      const rand = mulberry(g * 104729 + 7)
      let state = createGame({
        names: Array.from({ length: n }, (_, i) => `Bot${i}`),
        seed: g * 613 + 3,
      })
      let steps = 0
      for (; steps < 6000 && state.phase !== 'ended'; steps++) {
        const seat = actingSeat(state)
        // the bot sees ONLY what a human in that seat would see
        const intent = botIntent(viewFor(state, seat), rand)
        // any RuleError here is a policy bug — let it throw and fail the test
        state = applyIntent(state, seat, intent)
      }
      expect(state.phase, `game ${g} (${n}p) should end (steps=${steps})`).toBe('ended')
      expect(state.result).not.toBeNull()
    }
  }, 60_000)

  it('never knowingly attacks a teammate (3p: all roles are public)', () => {
    const rand = mulberry(42)
    for (let g = 0; g < 20; g++) {
      let state = createGame({ names: ['A', 'B', 'C'], seed: g * 17 + 5 })
      for (let steps = 0; steps < 4000 && state.phase !== 'ended'; steps++) {
        const seat = actingSeat(state)
        const view = viewFor(state, seat)
        const intent = botIntent(view, rand)
        if (intent.t === 'playWeapon') {
          const target = view.players[intent.target]
          expect(target.role && view.you.team === (target.role === 'shogun' ? 'shogun' : target.role.startsWith('ninja') ? 'ninja' : target.role.startsWith('samurai') ? 'shogun' : 'ronin')).toBe(false)
        }
        state = applyIntent(state, seat, intent)
      }
    }
  }, 30_000)
})
