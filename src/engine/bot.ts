import { cardDef, ROLES } from './cards'
import type { Card, Intent, PlayerView, PublicPlayer } from './types'

/**
 * The bot brain: a pure heuristic policy over the same redacted PlayerView a
 * human client gets — a bot never sees hidden hands or secret roles, so it
 * plays by exactly the information a person in that seat would have.
 *
 * `botIntent` returns ONE legal intent for whoever must act; the host applies
 * it and calls again on the next state. Every branch is legality-checked
 * against the view so the engine should never reject a bot move (the driver
 * still keeps a safe fallback, see session.ts).
 */

export type Rand = () => number

// ---------- Themed bot identities ----------

/** Rōnin-for-hire names; the lobby tags them as bots, in the duel they read as warriors. */
export const BOT_NAMES = [
  'Kaze 風', 'Yama 山', 'Kumo 雲', 'Kawa 川', 'Tsuki 月',
  'Hoshi 星', 'Arashi 嵐', 'Kitsune 狐', 'Tora 虎', 'Ryū 竜',
] as const

export function pickBotName(taken: string[], rand: Rand = Math.random): string {
  const free = BOT_NAMES.filter((n) => !taken.includes(n))
  if (free.length > 0) return free[Math.floor(rand() * free.length)]
  // all ten in use (impossible with 7 seats, but stay safe)
  return `Rōnin ${taken.length + 1}`
}

// ---------- Card valuation ----------

/** How much a bot wants to KEEP a card (higher = keep). Used for discards. */
function keepValue(card: Card): number {
  const def = cardDef(card)
  if (card.kind === 'parry') return 90
  if (card.kind === 'daimyo') return 80 // 1 honor at game end
  if (def.type === 'weapon') return 20 + def.damage! * 15 + def.difficulty! * 4
  if (def.type === 'property') return 60
  return 50 // remaining actions
}

function weapons(hand: Card[]): Card[] {
  return hand.filter((c) => cardDef(c).type === 'weapon')
}

function weakestWeapon(hand: Card[]): Card | null {
  const w = weapons(hand)
  if (w.length === 0) return null
  return w.reduce((a, b) => (keepValue(a) <= keepValue(b) ? a : b))
}

// ---------- Recomputing attack legality from the view ----------

/** Mirror of engine attackDifficulty, computed from public info only. */
export function viewAttackDifficulty(view: PlayerView, from: number, to: number): number {
  const n = view.playerCount
  const stepsIn = (dir: 1 | -1): number => {
    let steps = 0
    let s = from
    while (s !== to) {
      s = (s + dir + n) % n
      if (s === to || !view.players[s].harmless) steps++
    }
    return steps
  }
  const base = Math.min(stepsIn(1), stepsIn(-1))
  const target = view.players[to]
  let bonus = target.properties.filter((c) => c.kind === 'armor').length
  if (target.character === 'benkei') bonus += 1
  return base + bonus
}

// ---------- Target selection ----------

/**
 * Score how much this bot wants to attack `p`. Bots reason like a player:
 * the Shogun's role is public, everything else is table-read heuristics.
 */
function threatScore(view: PlayerView, p: PublicPlayer): number {
  if (p.seat === view.seat) return -Infinity
  if (p.harmless) return -Infinity
  const myTeam = view.you.team
  let score = p.honor * 3 + p.handCount
  // known roles (shogun always; everyone in 3p / at the end)
  if (p.role) {
    if (ROLES[p.role].team === myTeam) return -Infinity // never knowingly strike your own
    if (p.role === 'shogun') score += 25
  }
  // a defeat steals 1 honor for us — finishing blows are attractive
  if (p.resilience <= 2) score += 8
  return score
}

/** Best attackable target for `weapon`, or null. */
function bestTarget(view: PlayerView, weapon: Card, rand: Rand): number | null {
  const def = cardDef(weapon)
  const me = view.players[view.seat]
  const kojiro = me.character === 'kojiro'
  let best: { seat: number; score: number } | null = null
  for (const p of view.players) {
    const s = threatScore(view, p)
    if (s === -Infinity) continue
    const diff = viewAttackDifficulty(view, view.seat, p.seat)
    if (!kojiro && def.difficulty! < diff) continue
    const jitter = rand() * 4 // keep bots from being perfectly predictable
    if (!best || s + jitter > best.score) best = { seat: p.seat, score: s + jitter }
  }
  return best?.seat ?? null
}

/** Any non-self, non-teammate seat, favoring threats — for Geisha/Diversion/Bushido. */
function bestVictim(view: PlayerView, need: (p: PublicPlayer) => boolean, rand: Rand): number | null {
  let best: { seat: number; score: number } | null = null
  for (const p of view.players) {
    if (!need(p)) continue
    const s = threatScore(view, p)
    if (s === -Infinity) continue
    const jitter = rand() * 4
    if (!best || s + jitter > best.score) best = { seat: p.seat, score: s + jitter }
  }
  return best?.seat ?? null
}

// ---------- Prompt responses ----------

function respondToPrompt(view: PlayerView, rand: Rand): Intent {
  const prompt = view.prompt!
  const hand = view.you.hand
  const me = view.players[view.seat]
  const parries = hand.filter((c) => c.kind === 'parry')
  const hanzoWeapon =
    me.character === 'hanzo' && hand.length >= 2 ? weakestWeapon(hand) : null

  switch (prompt.type) {
    case 'parry': {
      // being defeated hands the attacker 1 honor — parry whenever we can
      if (parries.length > 0) return { t: 'respondParry', card: parries[0].id }
      if (hanzoWeapon) return { t: 'respondParry', card: hanzoWeapon.id }
      return { t: 'respondParry', card: null }
    }
    case 'forced': {
      const lethal = me.resilience <= 1
      if (prompt.kind === 'jiujitsu') {
        const w = weakestWeapon(hand)
        // give up a weapon only when the wound would defeat us or weapons are plentiful
        if (w && (lethal || weapons(hand).length >= 2)) return { t: 'respondForced', card: w.id }
        return { t: 'respondForced', card: null }
      }
      // battle cry: parries are precious — burn one only under real pressure
      if (parries.length > 0 && (lethal || parries.length >= 2)) {
        return { t: 'respondForced', card: parries[0].id }
      }
      if (hanzoWeapon && lethal) return { t: 'respondForced', card: hanzoWeapon.id }
      return { t: 'respondForced', card: null }
    }
    case 'bushido': {
      const w = weakestWeapon(hand)
      // the engine only asks when we hold a weapon; honor is victory points
      if (w) return { t: 'respondBushido', discardWeapon: w.id }
      return { t: 'respondBushido', loseHonor: true }
    }
    case 'ieyasu': {
      const top = view.discardTop
      const good =
        top != null &&
        (top.kind === 'parry' || top.kind === 'daimyo' ||
          (cardDef(top).type === 'weapon' && cardDef(top).damage! >= 2))
      return { t: 'respondIeyasu', fromDiscard: !!good }
    }
    case 'discard': {
      const sorted = [...hand].sort((a, b) => keepValue(a) - keepValue(b))
      return { t: 'respondDiscard', cards: sorted.slice(0, prompt.count).map((c) => c.id) }
    }
  }
}

// ---------- Turn play ----------

function playTurn(view: PlayerView, rand: Rand): Intent {
  const hand = view.you.hand
  const me = view.players[view.seat]

  // 1. Self-buff properties are free value — put them down first.
  const selfProp = hand.find(
    (c) => cardDef(c).type === 'property' && c.kind !== 'bushido',
  )
  if (selfProp) return { t: 'playProperty', card: selfProp.id }

  // Bushido: curse the biggest threat (only one may be in play, never on self).
  const bushido = hand.find((c) => c.kind === 'bushido')
  if (bushido && !view.players.some((p) => p.properties.some((c) => c.kind === 'bushido'))) {
    const victim = bestVictim(view, (p) => p.seat !== view.seat, rand)
    if (victim != null) return { t: 'playProperty', card: bushido.id, target: victim }
  }

  // 2. Card draw engines early, while the turn can still use the cards.
  const daimyo = hand.find((c) => c.kind === 'daimyo')
  if (daimyo && hand.length <= 6) return { t: 'playAction', card: daimyo.id }
  const tea = hand.find((c) => c.kind === 'teaceremony')
  if (tea && hand.length <= 3) return { t: 'playAction', card: tea.id }
  if (me.character === 'nobunaga' && me.resilience >= 3 && hand.length <= 3) {
    return { t: 'nobunaga' }
  }

  // 3. Heal when hurt (Breathing gifts a draw — hand it to the weakest table presence).
  const breathing = hand.find((c) => c.kind === 'breathing')
  if (breathing && me.maxResilience - me.resilience >= 2) {
    const others = view.players.filter((p) => p.seat !== view.seat)
    const gift = others.reduce((a, b) => (a.honor + a.handCount <= b.honor + b.handCount ? a : b))
    return { t: 'playAction', card: breathing.id, target: gift.seat }
  }

  // 4. Attack while we still may.
  if (view.weaponsPlayed < view.weaponsAllowed) {
    // strongest weapon that can actually land somewhere
    const armed = weapons(hand)
      .map((w) => ({ w, target: bestTarget(view, w, rand) }))
      .filter((x): x is { w: Card; target: number } => x.target != null)
      .sort((a, b) => cardDef(b.w).damage! - cardDef(a.w).damage!)
    if (armed.length > 0) {
      return { t: 'playWeapon', card: armed[0].w.id, target: armed[0].target }
    }
  }

  // 5. Disruption.
  const geisha = hand.find((c) => c.kind === 'geisha')
  if (geisha) {
    const propVictim = bestVictim(view, (p) => p.properties.some((c) => c.kind !== 'bushido'), rand)
    if (propVictim != null) {
      const prop = view.players[propVictim].properties.find((c) => c.kind !== 'bushido')!
      return { t: 'playAction', card: geisha.id, target: propVictim, propertyCard: prop.id }
    }
    const handVictim = bestVictim(view, (p) => p.handCount >= 3, rand)
    if (handVictim != null) return { t: 'playAction', card: geisha.id, target: handVictim }
  }
  const diversion = hand.find((c) => c.kind === 'diversion')
  if (diversion) {
    const victim = bestVictim(view, (p) => p.handCount > 0, rand)
    if (victim != null) return { t: 'playAction', card: diversion.id, target: victim }
  }

  // 6. Table-wide pressure once the table is worth pressuring.
  const cry = hand.find((c) => c.kind === 'battlecry' || c.kind === 'jiujitsu')
  if (cry) {
    const exposed = view.players.filter((p) => p.seat !== view.seat && !p.harmless).length
    if (exposed >= 2) return { t: 'playAction', card: cry.id }
  }

  return { t: 'endTurn' }
}

// ---------- Entry point ----------

/**
 * Decide the bot's next move. Call only when the view says this seat must act
 * (view.prompt is set, or it is this seat's turn with no pending prompt).
 */
export function botIntent(view: PlayerView, rand: Rand = Math.random): Intent {
  if (view.prompt) return respondToPrompt(view, rand)
  return playTurn(view, rand)
}
