import { CARD_DEFS } from '../engine/cards'
import type { Card, CharacterId, PlayerView, RoleId } from '../engine/types'

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
