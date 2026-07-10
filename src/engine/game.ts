import {
  CARD_DEFS, CHARACTERS, ROLES, ROLE_SETS, buildDeck, cardDef, initialHandSize, roleMultiplier,
} from './cards'
import { randInt, shuffle } from './rng'
import type {
  Card, GameResult, GameResultTeamScore, GameState, Intent, Pending, PlayerState, RoleId, Team,
} from './types'

export class RuleError extends Error {}

function gameEnded(state: GameState): boolean {
  return (state.phase as string) === 'ended'
}

function fail(msg: string): never {
  throw new RuleError(msg)
}

// ---------- Creation ----------

export interface GameConfig {
  names: string[]
  seed: number
  /** faster duels: cap everyone's starting Honor (null/undefined = full) */
  honorCap?: number | null
}

/** Starting Honor under the game's pace cap. */
export function cappedHonor(base: number, honorCap: number | null | undefined): number {
  return honorCap != null ? Math.min(base, honorCap) : base
}

export function createGame(config: GameConfig): GameState {
  const n = config.names.length
  if (n < 3 || n > 7) fail('Samurai Sword is for 3–7 players')
  let rng = config.seed | 0

  // roles
  const set = ROLE_SETS[n]
  const allNinjas: RoleId[] = ['ninja1', 'ninja2', 'ninja3']
  const sh1 = shuffle(allNinjas, rng)
  rng = sh1.state
  const roles: RoleId[] = [...set.fixed, ...sh1.arr.slice(0, set.ninjas)]
  const sh2 = shuffle(roles, rng)
  rng = sh2.state

  // characters
  const sh3 = shuffle(Object.keys(CHARACTERS) as (keyof typeof CHARACTERS)[], rng)
  rng = sh3.state

  // deck
  const sh4 = shuffle(buildDeck(), rng)
  rng = sh4.state
  const deck = sh4.arr

  // pace: a starting Honor below 2 would be defeat on the first hit; clamp to
  // 2–6 (6 = the highest natural start, the 3-player Shogun) so `full` is a no-op
  const honorCap =
    config.honorCap != null ? Math.max(2, Math.min(6, config.honorCap | 0)) : null

  const players: PlayerState[] = config.names.map((name, seat) => {
    const role = sh2.arr[seat]
    const character = sh3.arr[seat]
    const baseHonor =
      n === 3
        ? role === 'shogun' ? 6 : 3
        : role === 'shogun' ? 5 : (n <= 5 ? 3 : 4)
    return {
      seat,
      name,
      role,
      character,
      resilience: CHARACTERS[character].resilience,
      honor: cappedHonor(baseHonor, honorCap),
      hand: [],
      properties: [],
    }
  })

  const shogunSeat = players.find((p) => p.role === 'shogun')!.seat

  // initial hands, clockwise from the shogun
  for (let pos = 0; pos < n; pos++) {
    const seat = (shogunSeat + pos) % n
    const count = initialHandSize(pos)
    players[seat].hand = deck.splice(0, count)
  }

  const state: GameState = {
    playerCount: n,
    players,
    deck,
    discard: [],
    turnSeat: shogunSeat,
    phase: 'play',
    weaponsPlayed: 0,
    pending: null,
    rng,
    log: [],
    logN: 0,
    result: null,
    turnCount: 1,
    friendlyEndTeam: null,
    honorCap,
  }
  log(state, `The game begins — ${players[shogunSeat].name} is the Shogun.`)
  if (honorCap != null) {
    log(state, `A swift duel — everyone's Honor is capped at ${honorCap}.`)
  }
  // Shogun's first turn: full resilience, no bushido possible; draw phase.
  beginDrawPhase(state)
  return state
}

// ---------- Small helpers ----------

function log(state: GameState, text: string) {
  state.log.push({ n: state.logN++, text })
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200)
}

function player(state: GameState, seat: number): PlayerState {
  const p = state.players[seat]
  if (!p) fail(`No such seat ${seat}`)
  return p
}

function pname(state: GameState, seat: number): string {
  return player(state, seat).name
}

export function isHarmless(p: PlayerState): boolean {
  return p.resilience === 0 || p.hand.length === 0
}

function countProps(p: PlayerState, kind: string): number {
  return p.properties.filter((c) => c.kind === kind).length
}

export function weaponsAllowed(state: GameState, seat: number): number {
  const p = player(state, seat)
  let n = 1 + countProps(p, 'focus')
  if (p.character === 'goemon') n += 1
  if (state.playerCount === 3 && p.role === 'shogun') n += 1
  return n
}

/**
 * Attack difficulty from `from` to `to`: minimum seat distance around the table,
 * skipping harmless intermediate players, plus the target's Armor / Benkei bonus.
 */
export function attackDifficulty(state: GameState, from: number, to: number): number {
  const n = state.playerCount
  const stepsIn = (dir: 1 | -1): number => {
    let steps = 0
    let s = from
    while (s !== to) {
      s = (s + dir + n) % n
      if (s === to || !isHarmless(state.players[s])) steps++
    }
    return steps
  }
  const base = Math.min(stepsIn(1), stepsIn(-1))
  const target = player(state, to)
  let bonus = countProps(target, 'armor')
  if (target.character === 'benkei') bonus += 1
  return base + bonus
}

function removeFromHand(p: PlayerState, cardId: number): Card {
  const i = p.hand.findIndex((c) => c.id === cardId)
  if (i < 0) fail('That card is not in your hand')
  return p.hand.splice(i, 1)[0]
}

// ---------- Deck / drawing ----------

/** Reshuffle the discard pile into a new deck; every player loses 1 honor to the box. */
function reshuffle(state: GameState) {
  const sh = shuffle(state.discard, state.rng)
  state.rng = sh.state
  state.deck = sh.arr
  state.discard = []
  log(state, 'The deck is exhausted — it is reshuffled and every player loses 1 Honor.')
  for (const p of state.players) p.honor = Math.max(0, p.honor - 1)
  checkHonorEnd(state)
}

/** Draw n cards for seat (public count only). Stops early if the game ends mid-draw. */
function draw(state: GameState, seat: number, n: number) {
  const p = player(state, seat)
  let drawn = 0
  for (let i = 0; i < n; i++) {
    if (gameEnded(state)) return
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break // nothing left anywhere
      reshuffle(state)
      if (gameEnded(state)) return
    }
    p.hand.push(state.deck.shift()!)
    drawn++
  }
  if (drawn > 0) log(state, `${p.name} draws ${drawn} card${drawn > 1 ? 's' : ''}.`)
}

/** Flip the top deck card into the discard pile (for Bushido). Returns null if game ended. */
function flipTop(state: GameState): Card | null {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null
    reshuffle(state)
    if (gameEnded(state)) return null
  }
  const card = state.deck.shift()!
  state.discard.push(card)
  return card
}

// ---------- Wounds, defeat, game end ----------

function standing(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.resilience > 0)
}

function sameTeam(a: PlayerState, b: PlayerState): boolean {
  return ROLES[a.role].team === ROLES[b.role].team
}

function checkHonorEnd(state: GameState, friendlyTeam: Team | null = null): boolean {
  if (gameEnded(state)) return true
  if (state.players.some((p) => p.honor === 0)) {
    state.friendlyEndTeam = friendlyTeam
    endScored(state)
    return true
  }
  return false
}

/**
 * Apply wounds to a player. Handles defeat (honor transfer), Ushiwaka draws,
 * honor-exhaustion end, friendly-fire end and Sword Master victory.
 * Returns wounds actually applied.
 */
function applyWounds(
  state: GameState, targetSeat: number, amount: number, sourceSeat: number, viaWeapon: boolean,
): number {
  const target = player(state, targetSeat)
  const source = player(state, sourceSeat)
  const applied = Math.min(amount, target.resilience)
  if (applied <= 0) return 0
  target.resilience -= applied
  log(state, `${target.name} suffers ${applied} wound${applied > 1 ? 's' : ''}.`)

  if (viaWeapon && target.character === 'ushiwaka') {
    draw(state, targetSeat, applied)
    if (gameEnded(state)) return applied
  }

  if (target.resilience === 0) {
    // Defeat: victim hands 1 honor to the defeater.
    const friendly = sameTeam(target, source) && targetSeat !== sourceSeat
    target.honor -= 1
    source.honor += 1
    log(state, `${target.name} is defeated and gives 1 Honor to ${source.name}!`)
    if (checkHonorEnd(state, friendly ? ROLES[target.role].team : null)) return applied

    // Sword Master: only one player left with resilience.
    if (standing(state).length === 1 && state.playerCount !== 3) {
      if (friendly) {
        state.friendlyEndTeam = ROLES[target.role].team
        endScored(state)
      } else {
        endSwordmaster(state, standing(state)[0].seat)
      }
    }
  }
  return applied
}

// ---------- Scoring ----------

function endSwordmaster(state: GameState, lastSeat: number) {
  const winner = player(state, lastSeat)
  log(state, `${winner.name} is the last one standing — Sword Master victory for the ${ROLES[winner.role].team} team!`)
  state.phase = 'ended'
  state.pending = null
  state.result = {
    type: 'swordmaster',
    winnerTeam: ROLES[winner.role].team,
    swordmasterSeat: lastSeat,
    teams: scoreTeams(state),
  }
}

function endScored(state: GameState) {
  state.phase = 'ended'
  state.pending = null
  const teams = scoreTeams(state)
  const present = teams.filter((t) => t.members.length > 0)
  const best = Math.max(...present.map((t) => t.total))
  const top = present.filter((t) => t.total === best).map((t) => t.team)
  let winner: Team
  if (top.length === 1) winner = top[0]
  else if (top.includes('ninja')) winner = 'ninja'
  else winner = top.includes('shogun') ? 'shogun' : 'ronin'
  state.result = { type: 'scored', winnerTeam: winner, teams }
  log(state, `The game ends — the ${winner} team wins with honor!`)
}

function scoreTeams(state: GameState): GameResultTeamScore[] {
  const n = state.playerCount
  const ninjas = state.players.filter((p) => ROLES[p.role].team === 'ninja')
  const maxStars = Math.max(...ninjas.map((p) => ROLES[p.role].stars ?? 0))
  const teams: GameResultTeamScore[] = (['shogun', 'ninja', 'ronin'] as Team[]).map((team) => ({
    team,
    total: 0,
    penalty: state.friendlyEndTeam === team ? 3 : 0,
    members: [],
  }))
  for (const p of state.players) {
    const role = ROLES[p.role]
    const mult = roleMultiplier(p.role, n, role.team === 'ninja' && (role.stars ?? 0) === maxStars)
    const daimyo = role.team === 'ronin' ? 0 : p.hand.filter((c) => c.kind === 'daimyo').length
    const score = p.honor * mult + daimyo
    const entry = teams.find((t) => t.team === role.team)!
    entry.members.push({ seat: p.seat, role: p.role, honor: p.honor, multiplier: mult, daimyo, score })
    entry.total += score
  }
  for (const t of teams) t.total = Math.max(0, t.total - t.penalty)
  return teams.filter((t) => t.members.length > 0)
}

// ---------- Turn flow ----------

function beginDrawPhase(state: GameState) {
  const p = player(state, state.turnSeat)
  if (p.character === 'ieyasu' && state.discard.length > 0) {
    state.pending = { type: 'ieyasu', seat: p.seat }
    return
  }
  performDraws(state, false)
}

function drawCount(state: GameState, seat: number): number {
  const p = player(state, seat)
  let n = 2
  if (p.character === 'hideyoshi') n += 1
  if (state.playerCount === 3 && p.role === 'shogun') n += 1
  return n
}

function performDraws(state: GameState, firstFromDiscard: boolean) {
  const seat = state.turnSeat
  const p = player(state, seat)
  let n = drawCount(state, seat)
  if (firstFromDiscard && state.discard.length > 0) {
    p.hand.push(state.discard.pop()!)
    log(state, `${p.name} takes the top card of the discard pile.`)
    n -= 1
  }
  draw(state, seat, n)
  // phase stays 'play'; pending null means the turn player may act
  state.pending = null
}

function startNextTurn(state: GameState) {
  if (gameEnded(state)) return
  state.turnSeat = (state.turnSeat + 1) % state.playerCount
  state.turnCount++
  state.weaponsPlayed = 0
  const p = player(state, state.turnSeat)
  log(state, `— ${p.name}'s turn —`)

  // 1. Recover
  if (p.resilience === 0) {
    p.resilience = CHARACTERS[p.character].resilience
    log(state, `${p.name} recovers all Resilience.`)
  }

  // Bushido flips at the end of the Recover phase.
  const bushido = p.properties.find((c) => c.kind === 'bushido')
  if (bushido) {
    const flipped = flipTop(state)
    if (gameEnded(state)) return
    if (flipped && cardDef(flipped).type === 'weapon') {
      log(state, `Bushido reveals ${cardDef(flipped).name} — a Weapon! ${p.name} must choose.`)
      if (p.hand.some((c) => cardDef(c).type === 'weapon')) {
        state.pending = { type: 'bushido', seat: p.seat, flipped }
        return
      }
      // No weapon in hand: forced.
      resolveBushidoHonorLoss(state, p)
      if (gameEnded(state)) return
    } else if (flipped) {
      log(state, `Bushido reveals ${cardDef(flipped).name} — Bushido passes on.`)
      passBushido(state, p)
    }
  }

  // 2. Draw
  beginDrawPhase(state)
}

function passBushido(state: GameState, from: PlayerState) {
  const i = from.properties.findIndex((c) => c.kind === 'bushido')
  const card = from.properties.splice(i, 1)[0]
  const next = state.players[(from.seat + 1) % state.playerCount]
  next.properties.push(card)
  log(state, `Bushido moves to ${next.name}.`)
}

function resolveBushidoHonorLoss(state: GameState, p: PlayerState) {
  const i = p.properties.findIndex((c) => c.kind === 'bushido')
  const card = p.properties.splice(i, 1)[0]
  state.discard.push(card)
  if (state.playerCount === 3 && p.role === 'shogun') {
    log(state, `The Shogun never loses Honor to Bushido — it is discarded.`)
    return
  }
  p.honor = Math.max(0, p.honor - 1)
  log(state, `${p.name} loses 1 Honor to the Bushido code.`)
  checkHonorEnd(state)
}

// ---------- Forced choices (Battle Cry / Jiu-jitsu) ----------

function forcedQueue(state: GameState, sourceSeat: number): number[] {
  const q: number[] = []
  for (let i = 1; i < state.playerCount; i++) {
    const seat = (sourceSeat + i) % state.playerCount
    const p = state.players[seat]
    if (isHarmless(p)) continue
    if (p.character === 'chiyome') continue
    q.push(seat)
  }
  return q
}

/**
 * Advance a forced queue: skip players that are (now) harmless, auto-wound players
 * who cannot possibly answer, and stop on the first player with a real decision.
 */
function advanceForced(state: GameState) {
  while (state.pending && state.pending.type === 'forced') {
    const pending = state.pending
    while (pending.queue.length > 0 && isHarmless(state.players[pending.queue[0]])) {
      pending.queue.shift()
    }
    if (pending.queue.length === 0) {
      state.pending = null
      return
    }
    const seat = pending.queue[0]
    if (forcedAnswerable(state.players[seat], pending.kind)) return
    pending.queue.shift()
    applyWounds(state, seat, 1, pending.sourceSeat, false)
    if (gameEnded(state)) return
  }
}

/** Can `p` discard a card to answer this forced effect? */
function forcedAnswerable(p: PlayerState, kind: 'battlecry' | 'jiujitsu'): boolean {
  if (kind === 'jiujitsu') return p.hand.some((c) => cardDef(c).type === 'weapon')
  const hasParry = p.hand.some((c) => c.kind === 'parry')
  const hanzo = p.character === 'hanzo' && p.hand.length >= 2 && p.hand.some((c) => cardDef(c).type === 'weapon')
  return hasParry || hanzo
}

// ---------- Intent application ----------

export function applyIntent(prev: GameState, seat: number, intent: Intent): GameState {
  const state = structuredClone(prev)
  if (gameEnded(state)) fail('The game is over')

  const pending = state.pending
  if (pending) {
    applyResponse(state, seat, intent, pending)
    return state
  }

  if (seat !== state.turnSeat) fail('It is not your turn')
  const p = player(state, seat)

  switch (intent.t) {
    case 'playWeapon': {
      playWeapon(state, p, intent.card, intent.target)
      break
    }
    case 'playAction': {
      playAction(state, p, intent)
      break
    }
    case 'playProperty': {
      playProperty(state, p, intent.card, intent.target)
      break
    }
    case 'nobunaga': {
      if (p.character !== 'nobunaga') fail('Only Nobunaga can do that')
      if (p.resilience < 2) fail('You cannot spend your last Resilience point')
      p.resilience -= 1
      log(state, `${p.name} sacrifices 1 Resilience to draw a card.`)
      draw(state, seat, 1)
      break
    }
    case 'endTurn': {
      if (p.hand.length > 7) {
        state.pending = { type: 'discard', seat, count: p.hand.length - 7 }
      } else {
        startNextTurn(state)
      }
      break
    }
    default:
      fail('There is nothing to respond to')
  }
  return state
}

function applyResponse(state: GameState, seat: number, intent: Intent, pending: Pending) {
  const respondent =
    pending.type === 'forced' ? pending.queue[0] : pending.seat
  if (seat !== respondent) fail('Waiting for another player')
  const p = player(state, seat)

  switch (pending.type) {
    case 'parry': {
      if (intent.t !== 'respondParry') fail('You must respond to the attack')
      if (intent.card != null) {
        const card = validateParryCard(p, intent.card)
        removeFromHand(p, card.id)
        state.discard.push(card)
        log(state, `${p.name} parries with ${cardDef(card).name}!`)
        state.pending = null
      } else {
        state.pending = null
        const applied = applyWounds(state, seat, pending.damage, pending.attackerSeat, true)
        if (state.phase !== 'ended' && applied > 0) {
          const attacker = player(state, pending.attackerSeat)
          if (attacker.character === 'tomoe') draw(state, attacker.seat, 1)
        }
      }
      break
    }
    case 'forced': {
      if (intent.t !== 'respondForced') fail('You must respond first')
      if (intent.card != null) {
        const card = p.hand.find((c) => c.id === intent.card) ?? fail('That card is not in your hand')
        const def = cardDef(card)
        if (pending.kind === 'jiujitsu') {
          if (def.type !== 'weapon') fail('Jiu-jitsu requires discarding a Weapon')
        } else {
          const hanzoOk = p.character === 'hanzo' && def.type === 'weapon' && p.hand.length >= 2
          if (card.kind !== 'parry' && !hanzoOk) fail('Battle Cry requires discarding a Parry')
        }
        removeFromHand(p, card.id)
        state.discard.push(card)
        log(state, `${p.name} discards ${def.name}.`)
        pending.queue.shift()
      } else {
        pending.queue.shift()
        applyWounds(state, seat, 1, pending.sourceSeat, false)
        if (gameEnded(state)) return
      }
      advanceForced(state)
      break
    }
    case 'bushido': {
      if (intent.t !== 'respondBushido') fail('You must resolve Bushido first')
      if (intent.discardWeapon != null) {
        const card = p.hand.find((c) => c.id === intent.discardWeapon) ?? fail('That card is not in your hand')
        if (cardDef(card).type !== 'weapon') fail('You must discard a Weapon')
        removeFromHand(p, card.id)
        state.discard.push(card)
        log(state, `${p.name} discards ${cardDef(card).name} to honor Bushido.`)
        passBushido(state, p)
      } else {
        resolveBushidoHonorLoss(state, p)
        if (gameEnded(state)) return
      }
      state.pending = null
      beginDrawPhase(state)
      break
    }
    case 'ieyasu': {
      if (intent.t !== 'respondIeyasu') fail('You must choose where to draw from')
      state.pending = null
      performDraws(state, intent.fromDiscard)
      break
    }
    case 'discard': {
      if (intent.t !== 'respondDiscard') fail('You must discard down to 7 cards')
      if (intent.cards.length !== pending.count) fail(`You must discard exactly ${pending.count} card(s)`)
      for (const id of intent.cards) {
        const card = removeFromHand(p, id)
        state.discard.push(card)
      }
      log(state, `${p.name} discards down to 7 cards.`)
      state.pending = null
      startNextTurn(state)
      break
    }
  }
}

function validateParryCard(p: PlayerState, cardId: number): Card {
  const card = p.hand.find((c) => c.id === cardId) ?? fail('That card is not in your hand')
  if (card.kind === 'parry') return card
  if (p.character === 'hanzo' && cardDef(card).type === 'weapon' && p.hand.length >= 2) return card
  fail('That card cannot parry')
}

// ---------- Playing cards ----------

function playWeapon(state: GameState, p: PlayerState, cardId: number, targetSeat: number) {
  const card = p.hand.find((c) => c.id === cardId) ?? fail('That card is not in your hand')
  const def = cardDef(card)
  if (def.type !== 'weapon') fail('That is not a Weapon')
  if (state.weaponsPlayed >= weaponsAllowed(state, p.seat)) fail('You cannot play another Weapon this turn')
  if (targetSeat === p.seat) fail('You cannot attack yourself')
  const target = player(state, targetSeat)
  if (isHarmless(target)) fail(`${target.name} is Harmless and cannot be attacked`)
  const difficulty = attackDifficulty(state, p.seat, targetSeat)
  if (p.character !== 'kojiro' && def.difficulty! < difficulty) {
    fail(`${def.name} cannot reach difficulty ${difficulty}`)
  }

  removeFromHand(p, card.id)
  state.discard.push(card)
  state.weaponsPlayed++

  let damage = def.damage! + countProps(p, 'quickdraw')
  if (p.character === 'musashi') damage += 1
  if (target.character === 'ginchiyo') damage = Math.max(1, damage - 1)

  log(state, `${p.name} attacks ${target.name} with ${def.name} (${damage} wound${damage > 1 ? 's' : ''}).`)

  const canParry =
    target.hand.some((c) => c.kind === 'parry') ||
    (target.character === 'hanzo' && target.hand.length >= 2 && target.hand.some((c) => cardDef(c).type === 'weapon'))
  if (canParry) {
    state.pending = { type: 'parry', seat: targetSeat, attackerSeat: p.seat, weaponCard: card, damage }
  } else {
    const applied = applyWounds(state, targetSeat, damage, p.seat, true)
    if (state.phase !== 'ended' && applied > 0 && p.character === 'tomoe') {
      draw(state, p.seat, 1)
    }
  }
}

function playAction(
  state: GameState, p: PlayerState,
  intent: { card: number; target?: number; propertyCard?: number },
) {
  const card = p.hand.find((c) => c.id === intent.card) ?? fail('That card is not in your hand')
  const def = cardDef(card)
  if (def.type !== 'action') fail('That is not an Action')

  switch (card.kind) {
    case 'parry':
      fail('A Parry is only played in response to an attack')
      break
    case 'geisha': {
      if (intent.target == null || intent.target === p.seat) fail('Choose another player')
      const target = player(state, intent.target)
      removeFromHand(p, card.id)
      state.discard.push(card)
      if (intent.propertyCard != null) {
        const i = target.properties.findIndex((c) => c.id === intent.propertyCard)
        if (i < 0) fail('That property is not in play in front of that player')
        const prop = target.properties.splice(i, 1)[0]
        state.discard.push(prop)
        log(state, `${p.name} plays Geisha: ${target.name} discards ${cardDef(prop).name}.`)
      } else {
        if (target.hand.length === 0) fail(`${target.name} has no cards in hand`)
        const r = randInt(state.rng, target.hand.length)
        state.rng = r.state
        const stolen = target.hand.splice(r.value, 1)[0]
        state.discard.push(stolen)
        log(state, `${p.name} plays Geisha: ${target.name} discards a random card.`)
      }
      break
    }
    case 'diversion': {
      if (intent.target == null || intent.target === p.seat) fail('Choose another player')
      const target = player(state, intent.target)
      if (target.hand.length === 0) fail(`${target.name} has no cards in hand`)
      removeFromHand(p, card.id)
      state.discard.push(card)
      const r = randInt(state.rng, target.hand.length)
      state.rng = r.state
      const stolen = target.hand.splice(r.value, 1)[0]
      p.hand.push(stolen)
      log(state, `${p.name} plays Diversion and steals a random card from ${target.name}.`)
      break
    }
    case 'battlecry':
    case 'jiujitsu': {
      removeFromHand(p, card.id)
      state.discard.push(card)
      log(state, `${p.name} plays ${def.name}!`)
      const queue = forcedQueue(state, p.seat)
      if (queue.length > 0) {
        state.pending = { type: 'forced', kind: card.kind, sourceSeat: p.seat, queue, card }
        advanceForced(state)
      }
      break
    }
    case 'teaceremony': {
      removeFromHand(p, card.id)
      state.discard.push(card)
      log(state, `${p.name} performs the Tea Ceremony.`)
      draw(state, p.seat, 3)
      for (let i = 1; i < state.playerCount && state.phase !== 'ended'; i++) {
        draw(state, (p.seat + i) % state.playerCount, 1)
      }
      break
    }
    case 'daimyo': {
      removeFromHand(p, card.id)
      state.discard.push(card)
      log(state, `${p.name} plays Daimyo.`)
      draw(state, p.seat, 2)
      break
    }
    case 'breathing': {
      if (intent.target == null || intent.target === p.seat) fail('Choose another player to draw a card')
      const other = player(state, intent.target)
      removeFromHand(p, card.id)
      state.discard.push(card)
      p.resilience = CHARACTERS[p.character].resilience
      log(state, `${p.name} plays Breathing and recovers all Resilience.`)
      draw(state, other.seat, 1)
      break
    }
  }
}

function playProperty(state: GameState, p: PlayerState, cardId: number, targetSeat?: number) {
  const card = p.hand.find((c) => c.id === cardId) ?? fail('That card is not in your hand')
  const def = cardDef(card)
  if (def.type !== 'property') fail('That is not a Property')

  if (card.kind === 'bushido') {
    if (state.players.some((pl) => pl.properties.some((c) => c.kind === 'bushido'))) {
      fail('There is already a Bushido in play')
    }
    const target = player(state, targetSeat ?? fail('Choose a player for Bushido'))
    removeFromHand(p, card.id)
    target.properties.push(card)
    log(state, `${p.name} places Bushido in front of ${target.name}.`)
  } else {
    removeFromHand(p, card.id)
    p.properties.push(card)
    log(state, `${p.name} puts ${def.name} into play.`)
  }
}
