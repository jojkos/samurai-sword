import { CARD_DEFS } from '../engine/cards'
import type { Card, CardKind, CharacterId, PlayerView, RoleId } from '../engine/types'

export const CHARACTER_KANJI: Record<CharacterId, string> = {
  benkei: '弁慶', chiyome: '千代女', ginchiyo: '誾千代', goemon: '五右衛門',
  hanzo: '半蔵', hideyoshi: '秀吉', ieyasu: '家康', kojiro: '小次郎',
  musashi: '武蔵', nobunaga: '信長', tomoe: '巴御前', ushiwaka: '牛若丸',
}

export const ROLE_INFO: Record<RoleId, { name: string; kanji: string; team: string }> = {
  shogun: { name: 'Shogun', kanji: '将軍', team: 'shogun' },
  samurai1: { name: 'Samurai', kanji: '侍', team: 'shogun' },
  samurai2: { name: 'Samurai', kanji: '侍', team: 'shogun' },
  ninja1: { name: 'Ninja ★', kanji: '忍者', team: 'ninja' },
  ninja2: { name: 'Ninja ★★', kanji: '忍者', team: 'ninja' },
  ninja3: { name: 'Ninja ★★★', kanji: '忍者', team: 'ninja' },
  ronin: { name: 'Rōnin', kanji: '浪人', team: 'ronin' },
}

export const TEAM_LABEL: Record<string, string> = {
  shogun: 'Shogun & Samurai',
  ninja: 'Ninja',
  ronin: 'Rōnin',
}

const SAMURAI_GOAL =
  'Secret bodyguard of the Shogun. Samurai win (and lose) together with the Shogun as one team.'
const NINJA_GOAL =
  'Secret rival clan. The Ninja win if, when the game ends, they hold more honor than the Shogun’s side.'

export const ROLE_GOAL: Record<RoleId, string> = {
  shogun:
    'Plays face-up and leads the defense. Wins together with the Samurai if their team holds the most honor when the game ends.',
  samurai1: SAMURAI_GOAL,
  samurai2: SAMURAI_GOAL,
  ninja1: NINJA_GOAL,
  ninja2: NINJA_GOAL,
  ninja3: NINJA_GOAL,
  ronin:
    'Fights alone. The Rōnin’s honor counts double or triple in the final score — but he only wins if he beats every team by himself.',
}

export const HIDDEN_ROLE_TEXT =
  'This warrior’s role is secret — a Samurai, a Ninja, or the Rōnin. Only the Shogun plays face-up; everyone else is revealed when the game ends.'

/** Starting honor for a seat — pure view math, so lost honor can render as empty sockets. */
export function baseHonor(view: PlayerView, seat: number): number {
  const isShogun =
    seat === view.seat ? view.you.role === 'shogun' : view.players[seat].role === 'shogun'
  if (view.playerCount === 3) return isShogun ? 6 : 3
  if (isShogun) return 5
  return view.playerCount <= 5 ? 3 : 4
}

/** Weapon stats spelled out in plain language for the inspect panel. */
export function weaponStatLines(def: { difficulty?: number; damage?: number }): string[] {
  if (def.difficulty == null || def.damage == null) return []
  return [
    `Reach ${def.difficulty} — hits players up to difficulty ${def.difficulty}; Armor and Benkei make a target harder to reach`,
    `Wounds ${def.damage} — damage dealt when the hit lands`,
  ]
}

const NAMED_KINDS = Object.keys(CARD_DEFS) as CardKind[]

/** The FIRST card a chronicle line mentions (ties go to the longer name, so
 * "Battle Cry" beats any overlap) — the played card always comes first in
 * the engine's log sentences. */
export function cardKindInText(text: string): CardKind | null {
  let best: { kind: CardKind; idx: number; len: number } | null = null
  for (const kind of NAMED_KINDS) {
    const name = CARD_DEFS[kind].name
    const idx = text.indexOf(name)
    if (idx < 0) continue
    if (!best || idx < best.idx || (idx === best.idx && name.length > best.len)) {
      best = { kind, idx, len: name.length }
    }
  }
  return best?.kind ?? null
}

export interface ShowcaseEvent {
  kind: CardKind
  actorSeat: number
  isAttack: boolean
}

/* Only lines where someone actively plays a card get a showcase — draws,
   discards, wounds and Bushido flips would be noise. */
const PLAY_VERB = /^ (plays|attacks|parries with|performs|places|puts)\b/

/** Turn a chronicle line into a showcase event, or null if it isn't a play. */
export function showcaseFromLog(
  text: string,
  players: readonly { seat: number; name: string }[],
): ShowcaseEvent | null {
  if (text.startsWith('—')) return null
  // longest name first so "Jonas" is never mistaken for a player named "Jo"
  const actor = [...players]
    .sort((a, b) => b.name.length - a.name.length)
    .find((p) => text.startsWith(p.name + ' '))
  if (!actor) return null
  const rest = text.slice(actor.name.length)
  const verb = rest.match(PLAY_VERB)
  if (!verb) return null
  const kind = cardKindInText(rest)
  if (!kind) return null
  return { kind, actorSeat: actor.seat, isAttack: verb[1] === 'attacks' }
}

/** A card physically travelling across the table, parsed from a chronicle line.
 * `'deck'` origin and `'discard'` destination both resolve to the table centre. */
export interface FlightEvent {
  from: number | 'deck'
  to: number | 'discard'
  count: number
}

/** Turn a chronicle line into a card-flight, or null if nothing moved.
 * Reuses the same longest-name-first matching as {@link showcaseFromLog} so a
 * warrior named after a card is never mistaken for one. */
export function flightFromLog(
  text: string,
  players: readonly { seat: number; name: string }[],
): FlightEvent | null {
  if (text.startsWith('—')) return null
  const byLen = [...players].sort((a, b) => b.name.length - a.name.length)
  const actor = byLen.find((p) => text.startsWith(p.name + ' '))
  if (!actor) return null
  const rest = text.slice(actor.name.length)

  // draws fly deck → the drawer (cap the visible fan so Tea Ceremony stays sane)
  const drawn = rest.match(/^ draws (\d+) card/)
  if (drawn) return { from: 'deck', to: actor.seat, count: Math.min(3, Number(drawn[1])) }
  if (/^ takes the top card of the discard/.test(rest)) return { from: 'deck', to: actor.seat, count: 1 }
  if (/^ sacrifices 1 Resilience to draw/.test(rest)) return { from: 'deck', to: actor.seat, count: 1 }

  // Diversion is a true steal: the card flies victim → actor
  if (/^ plays Diversion and steals/.test(rest)) {
    const target = byLen.find((p) => rest.includes('from ' + p.name))
    if (target) return { from: target.seat, to: actor.seat, count: 1 }
  }
  // Geisha forces a discard: the card flies victim → the centre pile
  const geisha = rest.indexOf('plays Geisha:')
  if (geisha >= 0) {
    const after = rest.slice(geisha + 'plays Geisha:'.length).trimStart()
    const target = byLen.find((p) => after.startsWith(p.name))
    if (target) return { from: target.seat, to: 'discard', count: 1 }
  }
  return null
}

/** Distance between two seats, skipping harmless intermediates (mirrors the engine). */
export function viewDistance(view: PlayerView, from: number, to: number): number {
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
  return Math.min(stepsIn(1), stepsIn(-1))
}

export function viewAttackDifficulty(view: PlayerView, from: number, to: number): number {
  const target = view.players[to]
  let bonus = target.properties.filter((c) => c.kind === 'armor').length
  if (target.character === 'benkei') bonus += 1
  return viewDistance(view, from, to) + bonus
}

/** Seats this weapon can legally target right now. */
export function weaponTargets(view: PlayerView, card: Card): number[] {
  const def = CARD_DEFS[card.kind]
  if (def.type !== 'weapon') return []
  const me = view.players[view.seat]
  const targets: number[] = []
  for (const p of view.players) {
    if (p.seat === view.seat || p.harmless) continue
    if (me.character === 'kojiro' || def.difficulty! >= viewAttackDifficulty(view, view.seat, p.seat)) {
      targets.push(p.seat)
    }
  }
  return targets
}

export type TargetMode =
  | { kind: 'weapon'; card: Card; targets: number[] }
  | { kind: 'geisha'; card: Card; targets: number[] }
  | { kind: 'diversion'; card: Card; targets: number[] }
  | { kind: 'breathing'; card: Card; targets: number[] }
  | { kind: 'bushido'; card: Card; targets: number[] }

/** What happens when this hand card is clicked on my turn? */
export function cardAction(view: PlayerView, card: Card):
  | { play: true }
  | { target: TargetMode }
  | { blocked: string } {
  const def = CARD_DEFS[card.kind]
  const others = view.players.filter((p) => p.seat !== view.seat)
  switch (def.type) {
    case 'weapon': {
      if (view.weaponsPlayed >= view.weaponsAllowed) {
        return { blocked: 'No more Weapons this turn' }
      }
      const targets = weaponTargets(view, card)
      if (targets.length === 0) return { blocked: 'No target within reach' }
      return { target: { kind: 'weapon', card, targets } }
    }
    case 'property': {
      if (card.kind === 'bushido') {
        if (view.players.some((p) => p.properties.some((c) => c.kind === 'bushido'))) {
          return { blocked: 'A Bushido is already in play' }
        }
        return { target: { kind: 'bushido', card, targets: view.players.map((p) => p.seat) } }
      }
      return { play: true }
    }
    case 'action':
      switch (card.kind) {
        case 'parry':
          return { blocked: 'A Parry is only played when attacked' }
        case 'geisha': {
          const t = others.filter((p) => p.handCount > 0 || p.properties.length > 0).map((p) => p.seat)
          if (t.length === 0) return { blocked: 'No valid target' }
          return { target: { kind: 'geisha', card, targets: t } }
        }
        case 'diversion': {
          const t = others.filter((p) => p.handCount > 0).map((p) => p.seat)
          if (t.length === 0) return { blocked: 'Nobody has cards to steal' }
          return { target: { kind: 'diversion', card, targets: t } }
        }
        case 'breathing':
          return { target: { kind: 'breathing', card, targets: others.map((p) => p.seat) } }
        default:
          return { play: true }
      }
  }
}
