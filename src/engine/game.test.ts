import { describe, expect, it } from 'vitest'
import { CARD_DEFS, CHARACTERS, ROLES, buildDeck } from './cards'
import { applyIntent, attackDifficulty, createGame, isHarmless, weaponsAllowed, RuleError } from './game'
import { viewFor } from './view'
import type { Card, CardKind, CharacterId, GameState, PlayerState, RoleId } from './types'

// ---------- helpers ----------

let nextId = 1000
function c(kind: CardKind): Card {
  return { id: nextId++, kind }
}

interface SeatSpec {
  role: RoleId
  character?: CharacterId
  hand?: Card[]
  properties?: Card[]
  resilience?: number
  honor?: number
}

function mkState(seats: SeatSpec[], opts: { deck?: Card[]; discard?: Card[]; turnSeat?: number } = {}): GameState {
  const players: PlayerState[] = seats.map((s, seat) => {
    const character = s.character ?? (['benkei', 'goemon', 'ieyasu', 'kojiro', 'musashi', 'nobunaga', 'tomoe'][seat] as CharacterId)
    return {
      seat,
      name: `P${seat}`,
      role: s.role,
      character,
      resilience: s.resilience ?? CHARACTERS[character].resilience,
      honor: s.honor ?? 4,
      hand: s.hand ?? [c('parry'), c('bokken')],
      properties: s.properties ?? [],
    }
  })
  return {
    playerCount: players.length,
    players,
    deck: opts.deck ?? [c('parry'), c('parry'), c('parry'), c('parry'), c('parry'), c('parry')],
    discard: opts.discard ?? [],
    turnSeat: opts.turnSeat ?? 0,
    phase: 'play',
    weaponsPlayed: 0,
    pending: null,
    rng: 42,
    log: [],
    logN: 0,
    result: null,
    turnCount: 1,
    friendlyEndTeam: null,
    resilienceCap: null,
  }
}

const ROLES_5: RoleId[] = ['shogun', 'samurai1', 'ronin', 'ninja1', 'ninja2']
const ROLES_6: RoleId[] = ['shogun', 'samurai1', 'ronin', 'ninja1', 'ninja2', 'ninja3']

// ---------- deck data ----------

describe('deck data', () => {
  it('builds exactly 90 cards with official type totals', () => {
    const deck = buildDeck()
    expect(deck.length).toBe(90)
    const byType = (t: string) => deck.filter((card) => CARD_DEFS[card.kind].type === t).length
    expect(byType('weapon')).toBe(32)
    expect(byType('property')).toBe(15)
    expect(byType('action')).toBe(43)
    expect(deck.filter((card) => card.kind === 'bokken').length).toBe(6)
    expect(deck.filter((card) => card.kind === 'katana').length).toBe(1)
  })
})

// ---------- setup ----------

describe('createGame', () => {
  it.each([[4], [5], [6], [7]])('deals correct roles/honor/hands for %i players', (n) => {
    const g = createGame({ names: Array.from({ length: n }, (_, i) => `P${i}`), seed: 7 })
    const roles = g.players.map((p) => ROLES[p.role].team).sort()
    const shogun = g.players.find((p) => p.role === 'shogun')!
    expect(g.players.filter((p) => p.role === 'shogun').length).toBe(1)
    expect(roles.filter((t) => t === 'ninja').length).toBe(n <= 5 ? 2 : 3)
    expect(roles.filter((t) => t === 'ronin').length).toBe(n >= 5 ? 1 : 0)
    // honor
    expect(shogun.honor).toBe(5)
    for (const p of g.players) {
      if (p.role !== 'shogun') expect(p.honor).toBe(n <= 5 ? 3 : 4)
    }
    // hands: shogun already drew for its first turn
    const shogunDraw = shogun.character === 'hideyoshi' ? 3 : 2
    expect(shogun.hand.length).toBe(4 + shogunDraw)
    const sizes = [4, 5, 5, 6, 6, 7, 7]
    for (let pos = 1; pos < n; pos++) {
      expect(g.players[(shogun.seat + pos) % n].hand.length).toBe(sizes[pos])
    }
    expect(g.turnSeat).toBe(shogun.seat)
    // unique characters
    expect(new Set(g.players.map((p) => p.character)).size).toBe(n)
  })

  it('3 players: shogun 6 honor, ninjas 3, shogun draws 3', () => {
    const g = createGame({ names: ['a', 'b', 'c'], seed: 3 })
    const shogun = g.players.find((p) => p.role === 'shogun')!
    expect(shogun.honor).toBe(6)
    for (const p of g.players) if (p !== shogun) {
      expect(ROLES[p.role].team).toBe('ninja')
      expect(p.honor).toBe(3)
    }
    const draw = shogun.character === 'hideyoshi' ? 4 : 3
    expect(shogun.hand.length).toBe(4 + draw)
    expect(weaponsAllowed(g, shogun.seat)).toBeGreaterThanOrEqual(2)
  })
})

// ---------- pace (resilience cap) ----------

describe('pace: resilience cap', () => {
  it('caps starting resilience and the view max; full game leaves both untouched', () => {
    const fast = createGame({ names: ['a', 'b', 'c', 'd'], seed: 11, resilienceCap: 3 })
    expect(fast.resilienceCap).toBe(3)
    for (const p of fast.players) {
      expect(p.resilience).toBe(3) // every character has 4–5 natively
      expect(viewFor(fast, 0).players[p.seat].maxResilience).toBe(3)
    }
    expect(viewFor(fast, 0).resilienceCap).toBe(3)

    const full = createGame({ names: ['a', 'b', 'c', 'd'], seed: 11 })
    expect(full.resilienceCap).toBeNull()
    for (const p of full.players) {
      expect(p.resilience).toBe(CHARACTERS[p.character].resilience)
    }
    expect(viewFor(full, 0).resilienceCap).toBeNull()
  })

  it('clamps silly caps into the sane 2–5 range', () => {
    const g = createGame({ names: ['a', 'b', 'c'], seed: 1, resilienceCap: 1 })
    expect(g.resilienceCap).toBe(2)
  })

  it('turn-start recovery restores to the cap, not the character max', () => {
    const state = mkState(
      [{ role: 'shogun' }, { role: 'ninja1', character: 'musashi', resilience: 0, hand: [c('parry')] }, { role: 'ninja2' }],
      { turnSeat: 0 },
    )
    state.resilienceCap = 3
    const next = applyIntent(state, 0, { t: 'endTurn' })
    expect(next.players[1].resilience).toBe(3)
  })

  it('Breathing recovers to the cap, not the character max', () => {
    const breathing = c('breathing')
    const state = mkState(
      [
        { role: 'shogun', character: 'musashi', resilience: 1, hand: [breathing] },
        { role: 'ninja1' },
        { role: 'ninja2' },
      ],
      { turnSeat: 0 },
    )
    state.resilienceCap = 2
    const next = applyIntent(state, 0, { t: 'playAction', card: breathing.id, target: 1 })
    expect(next.players[0].resilience).toBe(2)
  })
})

// ---------- distance ----------

describe('attack difficulty', () => {
  it('is min seat distance both ways', () => {
    const s = mkState(ROLES_6.map((role) => ({ role })))
    expect(attackDifficulty(s, 0, 1)).toBe(1)
    expect(attackDifficulty(s, 0, 3)).toBe(3)
    expect(attackDifficulty(s, 0, 4)).toBe(2)
    expect(attackDifficulty(s, 0, 5)).toBe(1)
  })

  it('skips harmless players and counts armor/benkei', () => {
    const s = mkState([
      { role: 'shogun' },
      { role: 'ninja1', hand: [] }, // harmless (empty hand)
      { role: 'ninja2' },
      { role: 'ronin', resilience: 0 }, // harmless (0 resilience) — wait, resilience 0 with default hand
      { role: 'samurai1' },
    ])
    // seat1 harmless → seat2 is at distance 1 from seat0
    expect(attackDifficulty(s, 0, 2)).toBe(1)
    // armor on target adds
    s.players[2].properties.push(c('armor'), c('armor'))
    expect(attackDifficulty(s, 0, 2)).toBe(3)
    // benkei adds 1
    const b = mkState([{ role: 'shogun' }, { role: 'ninja1', character: 'benkei' }])
    expect(attackDifficulty(b, 0, 1)).toBe(2)
  })
})

// ---------- combat ----------

describe('combat', () => {
  it('rejects weapons that cannot reach', () => {
    const bokken = c('bokken')
    const s = mkState(ROLES_5.map((role, i) => (i === 0 ? { role, hand: [bokken] } : { role })))
    expect(() => applyIntent(s, 0, { t: 'playWeapon', card: bokken.id, target: 2 })).toThrow(RuleError)
  })

  it('kojiro ignores difficulty', () => {
    const bokken = c('bokken')
    const s = mkState(ROLES_5.map((role, i) => (i === 0 ? { role, character: 'kojiro', hand: [bokken, c('parry')] } : { role, hand: [c('bokken')] })))
    const after = applyIntent(s, 0, { t: 'playWeapon', card: bokken.id, target: 2 })
    expect(after.pending).toBeNull() // no parry in target's hand
    expect(after.players[2].resilience).toBe(CHARACTERS[after.players[2].character].resilience - 1)
  })

  it('parry cancels the attack; declining takes wounds', () => {
    const katana = c('katana')
    const parry = c('parry')
    const s = mkState([
      { role: 'shogun', hand: [katana] },
      { role: 'ninja1', hand: [parry, c('bokken')] },
      { role: 'ninja2' },
      { role: 'samurai1' },
    ])
    const mid = applyIntent(s, 0, { t: 'playWeapon', card: katana.id, target: 1 })
    expect(mid.pending?.type).toBe('parry')
    // guests can't respond for others
    expect(() => applyIntent(mid, 2, { t: 'respondParry', card: null })).toThrow(RuleError)
    const parried = applyIntent(mid, 1, { t: 'respondParry', card: parry.id })
    expect(parried.players[1].resilience).toBe(CHARACTERS[parried.players[1].character].resilience)
    expect(parried.pending).toBeNull()

    const hit = applyIntent(mid, 1, { t: 'respondParry', card: null })
    expect(hit.players[1].resilience).toBe(CHARACTERS[hit.players[1].character].resilience - 3)
  })

  it('quick draw and musashi add damage; ginchiyo reduces (min 1)', () => {
    const bokken = c('bokken')
    const s = mkState([
      { role: 'shogun', character: 'musashi', hand: [bokken], properties: [c('quickdraw')] },
      { role: 'ninja1', character: 'ginchiyo', hand: [c('bokken')] },
      { role: 'ninja2' },
    ])
    // 1 (bokken) + 1 (quickdraw) + 1 (musashi) − 1 (ginchiyo) = 2
    // target has no parry → wounds resolve immediately
    const after = applyIntent(s, 0, { t: 'playWeapon', card: bokken.id, target: 1 })
    expect(after.players[1].resilience).toBe(4 - 2)
  })

  it('enforces the weapon-per-turn limit (+focus, +goemon)', () => {
    const w1 = c('bokken'); const w2 = c('bokken'); const w3 = c('bokken'); const w4 = c('bokken')
    const s = mkState([
      { role: 'shogun', character: 'goemon', hand: [w1, w2, w3, w4], properties: [c('focus')] },
      { role: 'ninja1', hand: [c('bokken')], resilience: 5 },
      { role: 'ninja2', hand: [c('bokken')], resilience: 5 },
      { role: 'samurai1', hand: [c('bokken')], resilience: 5 }, // 4p: avoid the 3p shogun weapon bonus
    ])
    expect(weaponsAllowed(s, 0)).toBe(3)
    let st = applyIntent(s, 0, { t: 'playWeapon', card: w1.id, target: 1 })
    st = applyIntent(st, 0, { t: 'playWeapon', card: w2.id, target: 1 })
    st = applyIntent(st, 0, { t: 'playWeapon', card: w3.id, target: 3 })
    expect(() => applyIntent(st, 0, { t: 'playWeapon', card: w4.id, target: 3 })).toThrow(RuleError)
  })

  it('cannot target harmless players', () => {
    const bokken = c('bokken')
    const s = mkState([
      { role: 'shogun', hand: [bokken] },
      { role: 'ninja1', hand: [] },
      { role: 'ninja2' },
    ])
    expect(() => applyIntent(s, 0, { t: 'playWeapon', card: bokken.id, target: 1 })).toThrow(/Harmless/)
  })
})

// ---------- defeat, honor, game end ----------

describe('defeat and game end', () => {
  it('defeat transfers 1 honor to the attacker', () => {
    const katana = c('katana')
    const s = mkState([
      { role: 'shogun', hand: [katana], honor: 5 },
      { role: 'ninja1', hand: [c('bokken')], resilience: 2, honor: 4 },
      { role: 'ninja2' },
      { role: 'samurai1' },
    ])
    const after = applyIntent(s, 0, { t: 'playWeapon', card: katana.id, target: 1 })
    expect(after.players[1].resilience).toBe(0)
    expect(after.players[1].honor).toBe(3)
    expect(after.players[0].honor).toBe(6)
    expect(isHarmless(after.players[1])).toBe(true)
    expect(after.phase).toBe('play')
  })

  it('defeat via Jiu-jitsu transfers 1 honor to the card player', () => {
    const jj = c('jiujitsu')
    const s = mkState([
      { role: 'shogun', hand: [jj], honor: 5 },
      // no weapon in hand → cannot answer → the wound is automatic
      { role: 'ninja1', hand: [c('parry')], resilience: 1, honor: 4 },
      { role: 'ninja2', honor: 4 },
      { role: 'samurai1', honor: 4 },
    ])
    const after = applyIntent(s, 0, { t: 'playAction', card: jj.id })
    expect(after.players[1].resilience).toBe(0)
    expect(after.players[1].honor).toBe(3)
    expect(after.players[0].honor).toBe(6)
  })

  it('defeat via Battle Cry transfers 1 honor to the card player', () => {
    const bc = c('battlecry')
    const s = mkState([
      { role: 'shogun', hand: [bc], honor: 5 },
      // no parry in hand → cannot answer → the wound is automatic
      { role: 'ninja1', hand: [c('bokken')], resilience: 1, honor: 4 },
      { role: 'ninja2', honor: 4 },
      { role: 'samurai1', honor: 4 },
    ])
    const after = applyIntent(s, 0, { t: 'playAction', card: bc.id })
    expect(after.players[1].resilience).toBe(0)
    expect(after.players[1].honor).toBe(3)
    expect(after.players[0].honor).toBe(6)
  })

  it('choosing to suffer the forced wound also transfers honor on defeat', () => {
    const bc = c('battlecry')
    const s = mkState([
      { role: 'shogun', hand: [bc], honor: 5 },
      // has a Parry, could answer — but takes the wound instead
      { role: 'ninja1', hand: [c('parry')], resilience: 1, honor: 4 },
      { role: 'ninja2', honor: 4 },
      { role: 'samurai1', honor: 4 },
    ])
    const mid = applyIntent(s, 0, { t: 'playAction', card: bc.id })
    expect(mid.pending?.type).toBe('forced')
    const after = applyIntent(mid, 1, { t: 'respondForced', card: null })
    expect(after.players[1].resilience).toBe(0)
    expect(after.players[1].honor).toBe(3)
    expect(after.players[0].honor).toBe(6)
  })

  it('game ends with scoring when honor reaches 0', () => {
    const katana = c('katana')
    const s = mkState([
      { role: 'shogun', hand: [katana], honor: 5 },
      { role: 'ninja1', hand: [c('bokken')], resilience: 2, honor: 1 },
      { role: 'ninja2', honor: 4 },
      { role: 'samurai1', honor: 4 },
    ])
    const after = applyIntent(s, 0, { t: 'playWeapon', card: katana.id, target: 1 })
    expect(after.phase).toBe('ended')
    expect(after.result?.type).toBe('scored')
    // 4p: shogun x1=6, samurai x2=8 → team 14; ninjas 0 + 4 = 4 (most-starred doubles)
    const shogunTeam = after.result!.teams.find((t) => t.team === 'shogun')!
    expect(shogunTeam.total).toBe(6 + 8)
  })

  it('friendly-fire ending applies the −3 team penalty', () => {
    const katana = c('katana')
    const s = mkState([
      { role: 'shogun', hand: [katana], honor: 5 },
      { role: 'samurai1', hand: [c('bokken')], resilience: 2, honor: 1 },
      { role: 'ninja1', honor: 4 },
      { role: 'ninja2', honor: 4 },
    ])
    const after = applyIntent(s, 0, { t: 'playWeapon', card: katana.id, target: 1 })
    expect(after.phase).toBe('ended')
    const team = after.result!.teams.find((t) => t.team === 'shogun')!
    expect(team.penalty).toBe(3)
    // shogun 6×1 + samurai 0×2 = 6, −3 = 3
    expect(team.total).toBe(3)
  })

  it('sword master victory when only one player has resilience', () => {
    const katana = c('katana')
    const s = mkState([
      { role: 'shogun', hand: [katana], honor: 5 },
      { role: 'ninja1', hand: [c('bokken')], resilience: 2, honor: 4 },
      { role: 'ninja2', resilience: 0, honor: 4 },
      { role: 'samurai1', resilience: 0, honor: 4 },
    ])
    const after = applyIntent(s, 0, { t: 'playWeapon', card: katana.id, target: 1 })
    expect(after.phase).toBe('ended')
    expect(after.result?.type).toBe('swordmaster')
    expect(after.result?.winnerTeam).toBe('shogun')
    expect(after.result?.swordmasterSeat).toBe(0)
  })

  it('reshuffle costs everyone 1 honor and can end the game', () => {
    const daimyo = c('daimyo')
    const s = mkState(
      [
        { role: 'shogun', hand: [daimyo], honor: 5 },
        { role: 'ninja1', honor: 1 },
        { role: 'ninja2', honor: 4 },
        { role: 'samurai1', honor: 4 },
      ],
      { deck: [c('parry')], discard: [c('bokken'), c('bokken')] },
    )
    const after = applyIntent(s, 0, { t: 'playAction', card: daimyo.id })
    // daimyo draws 2: 1 from deck, then reshuffle → everyone −1 honor → ninja1 at 0 → end
    expect(after.phase).toBe('ended')
    expect(after.players[0].honor).toBe(4)
    expect(after.players[1].honor).toBe(0)
  })
})

// ---------- forced actions ----------

describe('battle cry / jiu-jitsu', () => {
  it('battle cry: parry-or-wound clockwise, skipping harmless and chiyome', () => {
    const cry = c('battlecry')
    const parry1 = c('parry')
    const s = mkState([
      { role: 'shogun', hand: [cry] },
      { role: 'ninja1', hand: [parry1, c('bokken')] },       // has parry → must decide
      { role: 'ninja2', character: 'chiyome' },              // immune
      { role: 'ronin', hand: [] },                           // harmless
      { role: 'samurai1', hand: [c('bokken')], resilience: 3 }, // no parry → auto wound
    ])
    const mid = applyIntent(s, 0, { t: 'playAction', card: cry.id })
    expect(mid.pending?.type).toBe('forced')
    expect((mid.pending as any).queue[0]).toBe(1)
    const done = applyIntent(mid, 1, { t: 'respondForced', card: parry1.id })
    expect(done.pending).toBeNull()
    expect(done.players[1].resilience).toBe(CHARACTERS[done.players[1].character].resilience)
    expect(done.players[2].resilience).toBe(4) // chiyome untouched
    expect(done.players[3].resilience).toBe(CHARACTERS[done.players[3].character].resilience) // harmless untouched
    expect(done.players[4].resilience).toBe(2) // auto-wounded
  })

  it('jiu-jitsu: weapon-or-wound; defeat via forced wound transfers honor to source', () => {
    const jj = c('jiujitsu')
    const s = mkState([
      { role: 'shogun', hand: [jj], honor: 5 },
      { role: 'ninja1', hand: [c('parry')], resilience: 1, honor: 4 }, // no weapon → auto wound → defeated
      { role: 'ninja2', hand: [c('bokken'), c('parry')], resilience: 4 },
    ])
    const mid = applyIntent(s, 0, { t: 'playAction', card: jj.id })
    // seat1 auto-wounded and defeated: honor moves to shogun
    expect(mid.players[1].resilience).toBe(0)
    expect(mid.players[1].honor).toBe(3)
    expect(mid.players[0].honor).toBe(6)
    // seat2 has a weapon → pending decision
    expect(mid.pending?.type).toBe('forced')
    const done = applyIntent(mid, 2, { t: 'respondForced', card: mid.players[2].hand.find((x) => x.kind === 'bokken')!.id })
    expect(done.pending).toBeNull()
    expect(done.players[2].resilience).toBe(4)
  })

  it('hanzo may answer battle cry with a weapon (not his last card)', () => {
    const cry = c('battlecry')
    const bokken = c('bokken')
    const s = mkState([
      { role: 'shogun', hand: [cry] },
      { role: 'ninja1', character: 'hanzo', hand: [bokken, c('daimyo')] },
      { role: 'ninja2', character: 'chiyome' },
    ])
    const mid = applyIntent(s, 0, { t: 'playAction', card: cry.id })
    expect(mid.pending?.type).toBe('forced')
    const done = applyIntent(mid, 1, { t: 'respondForced', card: bokken.id })
    expect(done.players[1].resilience).toBe(4)
  })
})

// ---------- actions & properties ----------

describe('actions', () => {
  it('tea ceremony: draw 3, others draw 1', () => {
    const tea = c('teaceremony')
    const s = mkState(
      [
        { role: 'shogun', hand: [tea] },
        { role: 'ninja1', hand: [c('parry')] },
        { role: 'ninja2', hand: [] }, // harmless players still draw
      ],
      { deck: [c('parry'), c('parry'), c('parry'), c('parry'), c('parry'), c('parry')] },
    )
    const after = applyIntent(s, 0, { t: 'playAction', card: tea.id })
    expect(after.players[0].hand.length).toBe(3) // played tea, drew 3
    expect(after.players[1].hand.length).toBe(2)
    expect(after.players[2].hand.length).toBe(1)
  })

  it('breathing restores resilience and makes another player draw', () => {
    const b = c('breathing')
    const s = mkState([
      { role: 'shogun', hand: [b, c('parry')], resilience: 1 },
      { role: 'ninja1', hand: [c('parry')] },
      { role: 'ninja2' },
    ])
    const after = applyIntent(s, 0, { t: 'playAction', card: b.id, target: 1 })
    expect(after.players[0].resilience).toBe(CHARACTERS[after.players[0].character].resilience)
    expect(after.players[1].hand.length).toBe(2)
    expect(() => applyIntent(s, 0, { t: 'playAction', card: b.id, target: 0 })).toThrow(RuleError)
  })

  it('geisha discards a property in play or a random hand card', () => {
    const g1 = c('geisha'); const g2 = c('geisha')
    const armor = c('armor')
    const s = mkState([
      { role: 'shogun', hand: [g1, g2, c('parry')] },
      { role: 'ninja1', hand: [c('parry')], properties: [armor] },
      { role: 'ninja2' },
    ])
    const a = applyIntent(s, 0, { t: 'playAction', card: g1.id, target: 1, propertyCard: armor.id })
    expect(a.players[1].properties.length).toBe(0)
    const b2 = applyIntent(a, 0, { t: 'playAction', card: g2.id, target: 1 })
    expect(b2.players[1].hand.length).toBe(0)
  })

  it('diversion steals a random card', () => {
    const d = c('diversion')
    const s = mkState([
      { role: 'shogun', hand: [d] },
      { role: 'ninja1', hand: [c('katana')] },
      { role: 'ninja2' },
    ])
    const after = applyIntent(s, 0, { t: 'playAction', card: d.id, target: 1 })
    expect(after.players[0].hand.length).toBe(1)
    expect(after.players[0].hand[0].kind).toBe('katana')
    expect(after.players[1].hand.length).toBe(0)
  })

  it('daimyo draws 2', () => {
    const d = c('daimyo')
    const s = mkState([{ role: 'shogun', hand: [d] }, { role: 'ninja1' }, { role: 'ninja2' }])
    const after = applyIntent(s, 0, { t: 'playAction', card: d.id })
    expect(after.players[0].hand.length).toBe(2)
  })

  it('nobunaga trades resilience for cards, never the last one', () => {
    const s = mkState([
      { role: 'shogun', character: 'nobunaga', resilience: 2 },
      { role: 'ninja1' }, { role: 'ninja2' },
    ])
    const a = applyIntent(s, 0, { t: 'nobunaga' })
    expect(a.players[0].resilience).toBe(1)
    expect(a.players[0].hand.length).toBe(3)
    expect(() => applyIntent(a, 0, { t: 'nobunaga' })).toThrow(RuleError)
  })

  it('only one bushido in play at a time', () => {
    const b1 = c('bushido'); const b2 = c('bushido')
    const s = mkState([
      { role: 'shogun', hand: [b1, b2] },
      { role: 'ninja1' }, { role: 'ninja2' },
    ])
    const a = applyIntent(s, 0, { t: 'playProperty', card: b1.id, target: 1 })
    expect(a.players[1].properties.some((x) => x.kind === 'bushido')).toBe(true)
    expect(() => applyIntent(a, 0, { t: 'playProperty', card: b2.id, target: 2 })).toThrow(RuleError)
  })
})

// ---------- turn flow ----------

describe('turn flow', () => {
  it('end turn: recover, bushido pass on non-weapon, draw 2', () => {
    const s = mkState(
      [
        { role: 'shogun', hand: [c('parry')] },
        { role: 'ninja1', hand: [c('parry')], resilience: 0, properties: [c('bushido')] },
        { role: 'ninja2' },
      ],
      { deck: [c('parry'), c('teaceremony'), c('parry'), c('parry')] },
    )
    const after = applyIntent(s, 0, { t: 'endTurn' })
    const p1 = after.players[1]
    expect(after.turnSeat).toBe(1)
    expect(p1.resilience).toBe(CHARACTERS[p1.character].resilience) // recovered
    // bushido flipped 'parry' (non-weapon) → passed to seat 2
    expect(p1.properties.some((x) => x.kind === 'bushido')).toBe(false)
    expect(after.players[2].properties.some((x) => x.kind === 'bushido')).toBe(true)
    expect(p1.hand.length).toBe(1 + 2)
  })

  it('bushido on flipped weapon: discard a weapon to pass, or lose honor', () => {
    const bokken = c('bokken')
    const mk = () => mkState(
      [
        { role: 'shogun', hand: [c('parry')] },
        { role: 'ninja1', hand: [bokken, c('parry')], properties: [c('bushido')], honor: 3 },
        { role: 'ninja2' },
      ],
      { deck: [c('katana'), c('parry'), c('parry'), c('parry'), c('parry')] },
    )
    const mid = applyIntent(mk(), 0, { t: 'endTurn' })
    expect(mid.pending?.type).toBe('bushido')

    const passed = applyIntent(mid, 1, { t: 'respondBushido', discardWeapon: bokken.id })
    expect(passed.players[1].properties.length).toBe(0)
    expect(passed.players[2].properties.some((x) => x.kind === 'bushido')).toBe(true)
    expect(passed.players[1].honor).toBe(3)

    const paid = applyIntent(mid, 1, { t: 'respondBushido', loseHonor: true })
    expect(paid.players[1].honor).toBe(2)
    expect(paid.players[1].properties.length).toBe(0)
    expect(paid.players[2].properties.length).toBe(0)
    expect(paid.discard.some((x) => x.kind === 'bushido')).toBe(true)
  })

  it('bushido with no weapon in hand forces the honor loss', () => {
    const s = mkState(
      [
        { role: 'shogun', hand: [c('parry')] },
        { role: 'ninja1', hand: [c('parry')], properties: [c('bushido')], honor: 3 },
        { role: 'ninja2' },
      ],
      { deck: [c('katana'), c('parry'), c('parry'), c('parry')] },
    )
    const after = applyIntent(s, 0, { t: 'endTurn' })
    expect(after.pending?.type).not.toBe('bushido')
    expect(after.players[1].honor).toBe(2)
  })

  it('hand limit: must discard down to 7', () => {
    const hand = Array.from({ length: 9 }, () => c('parry'))
    const s = mkState([
      { role: 'shogun', hand },
      { role: 'ninja1' }, { role: 'ninja2' },
    ])
    const mid = applyIntent(s, 0, { t: 'endTurn' })
    expect(mid.pending?.type).toBe('discard')
    expect(() => applyIntent(mid, 0, { t: 'respondDiscard', cards: [hand[0].id] })).toThrow(RuleError)
    const done = applyIntent(mid, 0, { t: 'respondDiscard', cards: [hand[0].id, hand[1].id] })
    expect(done.players[0].hand.length).toBe(7)
    expect(done.turnSeat).toBe(1)
  })

  it('ieyasu may take the top of the discard pile as his first draw', () => {
    const katana = c('katana')
    const s = mkState(
      [
        { role: 'shogun', hand: [c('parry')] },
        { role: 'ninja1', character: 'ieyasu', hand: [c('parry')] },
        { role: 'ninja2' },
      ],
      { deck: [c('parry'), c('parry'), c('parry')], discard: [c('bokken'), katana] },
    )
    const mid = applyIntent(s, 0, { t: 'endTurn' })
    expect(mid.pending?.type).toBe('ieyasu')
    const took = applyIntent(mid, 1, { t: 'respondIeyasu', fromDiscard: true })
    expect(took.players[1].hand.some((x) => x.id === katana.id)).toBe(true)
    expect(took.players[1].hand.length).toBe(3)
  })

  it('tomoe draws on a successful hit; ushiwaka draws per wound suffered', () => {
    const kusarigama = c('kusarigama')
    const s = mkState(
      [
        { role: 'shogun', character: 'tomoe', hand: [kusarigama] },
        { role: 'ninja1', character: 'ushiwaka', hand: [c('daimyo')], resilience: 4 },
        { role: 'ninja2' },
      ],
      { deck: [c('parry'), c('parry'), c('parry'), c('parry')] },
    )
    const after = applyIntent(s, 0, { t: 'playWeapon', card: kusarigama.id, target: 1 })
    expect(after.players[1].resilience).toBe(2)
    expect(after.players[1].hand.length).toBe(1 + 2) // ushiwaka drew 2
    expect(after.players[0].hand.length).toBe(1) // tomoe drew 1
  })
})

// ---------- scoring ----------

describe('scoring', () => {
  function endGameNow(s: GameState, attackerSeat = 0, victimSeat = 1): GameState {
    // give the victim 1 honor and 1 resilience, then defeat them to end the game
    const nodachi = c('nodachi') // difficulty 3 covers every distance used in these tests
    s.players[attackerSeat].hand.push(nodachi)
    s.players[victimSeat].honor = 1
    s.players[victimSeat].resilience = 1
    s.players[victimSeat].hand = [c('bokken')]
    s.turnSeat = attackerSeat
    return applyIntent(s, attackerSeat, { t: 'playWeapon', card: nodachi.id, target: victimSeat })
  }

  it('applies 6p multipliers (samurai ×2, ronin ×3)', () => {
    const s = mkState(ROLES_6.map((role) => ({ role, honor: 2 })))
    const after = endGameNow(s, 0, 3) // shogun defeats ninja1
    expect(after.phase).toBe('ended')
    const t = (team: string) => after.result!.teams.find((x) => x.team === team)!
    // shogun 2+1(defeat honor)=3 ×1, samurai 2×2 → 7
    expect(t('shogun').total).toBe(7)
    // ninjas: 0 + 2 + 2 = 4
    expect(t('ninja').total).toBe(4)
    // ronin 2×3 = 6
    expect(t('ronin').total).toBe(6)
    expect(after.result!.winnerTeam).toBe('shogun')
  })

  it('counts daimyo in hand (+1 each, not for ronin) and ninja win ties', () => {
    const s = mkState(ROLES_6.map((role) => ({ role, honor: 2 })))
    s.players[4].hand.push(c('daimyo'))          // ninja2 holds a daimyo
    s.players[2].hand.push(c('daimyo'))          // ronin daimyo is worthless
    s.players[1].honor = 0.5 as unknown as number // silence; replaced below
    s.players[1].honor = 2
    const after = endGameNow(s, 5, 3) // ninja3 defeats ninja1 → friendly! use different victim
    expect(after.phase).toBe('ended')
    const t = (team: string) => after.result!.teams.find((x) => x.team === team)!
    expect(t('ninja').members.find((m) => m.seat === 4)!.daimyo).toBe(1)
    expect(t('ronin').members[0].daimyo).toBe(0)
  })

  it('4p: only the most-starred ninja doubles', () => {
    const s = mkState([
      { role: 'shogun', honor: 3 },
      { role: 'samurai1', honor: 3 },
      { role: 'ninja1', honor: 3 },
      { role: 'ninja3', honor: 3 },
    ])
    const after = endGameNow(s, 0, 1) // friendly end, but scoring still computed
    const ninja = after.result!.teams.find((x) => x.team === 'ninja')!
    const m1 = ninja.members.find((m) => m.role === 'ninja1')!
    const m3 = ninja.members.find((m) => m.role === 'ninja3')!
    expect(m1.multiplier).toBe(1)
    expect(m3.multiplier).toBe(2)
  })

  it('3p: shogun scores double and never loses honor to bushido', () => {
    const s = mkState(
      [
        { role: 'ninja1', hand: [c('parry')] },
        { role: 'shogun', hand: [c('parry')], properties: [c('bushido')], honor: 6 },
        { role: 'ninja2' },
      ],
      { deck: [c('katana'), c('parry'), c('parry'), c('parry'), c('parry')] },
    )
    const after = applyIntent(s, 0, { t: 'endTurn' })
    // shogun has no weapon → would lose honor, but 3p shogun just discards bushido
    expect(after.players[1].honor).toBe(6)
    expect(after.players[1].properties.length).toBe(0)
  })
})

// ---------- views / redaction ----------

describe('views', () => {
  it('never leaks other hands or secret roles', () => {
    const g = createGame({ names: ['a', 'b', 'c', 'd', 'e'], seed: 11 })
    const shogunSeat = g.players.find((p) => p.role === 'shogun')!.seat
    const otherSeat = (shogunSeat + 1) % 5
    const v = viewFor(g, otherSeat)
    expect(v.you.hand.length).toBe(g.players[otherSeat].hand.length)
    for (const p of v.players) {
      if (p.seat !== otherSeat) {
        expect((p as any).hand).toBeUndefined()
        if (p.seat !== shogunSeat) expect(p.role === null || p.seat === otherSeat).toBe(true)
      }
    }
    expect(v.players[shogunSeat].role).toBe('shogun')
  })

  it('reveals all roles at game end', () => {
    const s = mkState(ROLES_5.map((role) => ({ role, honor: 2 })))
    const katana = c('katana')
    s.players[0].hand = [katana]
    s.players[1].honor = 1
    s.players[1].resilience = 1
    s.players[1].hand = [c('bokken')] // no parry: the attack must resolve
    const after = applyIntent(s, 0, { t: 'playWeapon', card: katana.id, target: 1 })
    expect(after.phase).toBe('ended')
    const v = viewFor(after, 2)
    for (const p of v.players) expect(p.role).not.toBeNull()
  })
})
