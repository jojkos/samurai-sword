import type {
  Card, CardDef, CardKind, CharacterDef, CharacterId, RoleDef, RoleId,
} from './types'

/**
 * The original Samurai Sword roster. Names, effects, weapon stats and type totals
 * (32 weapons / 15 properties / 43 actions) follow the official rulebook.
 * Per-card copy counts marked [approx] are a documented approximation that respects
 * every publicly confirmed fact (6x Bokken, 1x each of Wakizashi/Katana/Nodachi).
 */
export const CARD_DEFS: Record<CardKind, CardDef> = {
  // ----- Weapons (32) — difficulty / damage -----
  bokken:      { kind: 'bokken', type: 'weapon', name: 'Bokken', kanji: '木剣', count: 6, difficulty: 1, damage: 1, text: 'Attack a player at difficulty 1 for 1 wound.' },
  kiseru:      { kind: 'kiseru', type: 'weapon', name: 'Kiseru', kanji: '煙管', count: 3, difficulty: 1, damage: 2, text: 'Attack a player at difficulty 1 for 2 wounds.' }, // [approx]
  bo:          { kind: 'bo', type: 'weapon', name: 'Bō', kanji: '棒', count: 3, difficulty: 1, damage: 2, text: 'Attack a player at difficulty 1 for 2 wounds.' }, // [approx]
  shuriken:    { kind: 'shuriken', type: 'weapon', name: 'Shuriken', kanji: '手裏剣', count: 4, difficulty: 3, damage: 1, text: 'Attack a player at difficulty up to 3 for 1 wound.' }, // [approx]
  kusarigama:  { kind: 'kusarigama', type: 'weapon', name: 'Kusarigama', kanji: '鎖鎌', count: 4, difficulty: 2, damage: 2, text: 'Attack a player at difficulty up to 2 for 2 wounds.' }, // [approx]
  nagayari:    { kind: 'nagayari', type: 'weapon', name: 'Nagayari', kanji: '長槍', count: 3, difficulty: 2, damage: 1, text: 'Attack a player at difficulty up to 2 for 1 wound.' }, // [approx]
  kanabo:      { kind: 'kanabo', type: 'weapon', name: 'Kanabō', kanji: '金棒', count: 2, difficulty: 3, damage: 2, text: 'Attack a player at difficulty up to 3 for 2 wounds.' }, // [approx]
  naginata:    { kind: 'naginata', type: 'weapon', name: 'Naginata', kanji: '薙刀', count: 2, difficulty: 4, damage: 1, text: 'Attack a player at difficulty up to 4 for 1 wound.' }, // [approx]
  daikyu:      { kind: 'daikyu', type: 'weapon', name: 'Daikyū', kanji: '大弓', count: 1, difficulty: 5, damage: 2, text: 'Attack a player at difficulty up to 5 for 2 wounds.' },
  tanegashima: { kind: 'tanegashima', type: 'weapon', name: 'Tanegashima', kanji: '種子島', count: 1, difficulty: 5, damage: 1, text: 'Attack a player at difficulty up to 5 for 1 wound.' },
  wakizashi:   { kind: 'wakizashi', type: 'weapon', name: 'Wakizashi', kanji: '脇差', count: 1, difficulty: 1, damage: 3, text: 'Attack a player at difficulty 1 for 3 wounds.' },
  katana:      { kind: 'katana', type: 'weapon', name: 'Katana', kanji: '刀', count: 1, difficulty: 2, damage: 3, text: 'Attack a player at difficulty up to 2 for 3 wounds.' },
  nodachi:     { kind: 'nodachi', type: 'weapon', name: 'Nodachi', kanji: '野太刀', count: 1, difficulty: 3, damage: 3, text: 'Attack a player at difficulty up to 3 for 3 wounds.' },

  // ----- Actions (43) -----
  parry:       { kind: 'parry', type: 'action', name: 'Parry', kanji: '受け流し', count: 15, text: 'Play out of turn to stop a Weapon attack aimed at you.' },
  geisha:      { kind: 'geisha', type: 'action', name: 'Geisha', kanji: '芸者', count: 6, text: 'Discard 1 card in play in front of another player, or a random card from their hand.' }, // [approx]
  diversion:   { kind: 'diversion', type: 'action', name: 'Diversion', kanji: '陽動', count: 5, text: 'Draw 1 random card from the hand of any other player.' }, // [approx]
  jiujitsu:    { kind: 'jiujitsu', type: 'action', name: 'Jiu-jitsu', kanji: '柔術', count: 4, text: 'Each other player must discard a Weapon or suffer 1 wound.' }, // [approx]
  battlecry:   { kind: 'battlecry', type: 'action', name: 'Battle Cry', kanji: '鬨の声', count: 4, text: 'Each other player must discard a Parry or suffer 1 wound.' }, // [approx]
  teaceremony: { kind: 'teaceremony', type: 'action', name: 'Tea Ceremony', kanji: '茶の湯', count: 4, text: 'Draw 3 cards. Each other player draws 1 card.' }, // [approx]
  daimyo:      { kind: 'daimyo', type: 'action', name: 'Daimyo', kanji: '大名', count: 3, text: 'Draw 2 cards. Worth 1 Honor if in your hand at game end (0 for the Ronin).' },
  breathing:   { kind: 'breathing', type: 'action', name: 'Breathing', kanji: '呼吸', count: 2, text: 'Recover all your Resilience. Another player of your choice draws 1 card.' }, // [approx]

  // ----- Properties (15) -----
  focus:       { kind: 'focus', type: 'property', name: 'Focus', kanji: '集中', count: 5, text: 'You may play 1 additional Weapon each turn.' }, // [approx]
  armor:       { kind: 'armor', type: 'property', name: 'Armor', kanji: '鎧', count: 4, text: 'Other players add +1 to the Difficulty when attacking you.' }, // [approx]
  quickdraw:   { kind: 'quickdraw', type: 'property', name: 'Quick Draw', kanji: '早抜き', count: 4, text: 'Your Weapons deal 1 additional wound.' }, // [approx]
  bushido:     { kind: 'bushido', type: 'property', name: 'Bushido', kanji: '武士道', count: 2, text: 'Place in front of any player. On their turn they flip the top deck card: a Weapon forces them to discard a Weapon and pass Bushido on, or lose 1 Honor and discard it. Otherwise Bushido passes on.' },
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  benkei:    { id: 'benkei', name: 'Benkei', resilience: 5, text: 'Other players add +1 to the Difficulty when attacking you.' },
  chiyome:   { id: 'chiyome', name: 'Chiyome', resilience: 4, text: 'You can only be wounded by Weapon cards. Jiu-jitsu and Battle Cry do not affect you.' },
  ginchiyo:  { id: 'ginchiyo', name: 'Ginchiyo', resilience: 4, text: 'You suffer 1 less wound from Weapons (minimum 1).' },
  goemon:    { id: 'goemon', name: 'Goemon', resilience: 5, text: 'You may play 1 additional Weapon card during your turn.' },
  hanzo:     { id: 'hanzo', name: 'Hanzō', resilience: 4, text: 'You may play a Weapon card as a Parry, unless it is the last card in your hand.' },
  hideyoshi: { id: 'hideyoshi', name: 'Hideyoshi', resilience: 4, text: 'You draw 1 additional card during your Draw phase.' },
  ieyasu:    { id: 'ieyasu', name: 'Ieyasu', resilience: 5, text: 'The first card you draw in your Draw phase may be the top card of the discard pile.' },
  kojiro:    { id: 'kojiro', name: 'Kojirō', resilience: 5, text: 'Your Weapons can hit at any Difficulty.' },
  musashi:   { id: 'musashi', name: 'Musashi', resilience: 5, text: 'Your Weapons deal 1 additional wound.' },
  nobunaga:  { id: 'nobunaga', name: 'Nobunaga', resilience: 5, text: 'During your turn you may discard 1 Resilience point (not your last) to draw 1 card.' },
  tomoe:     { id: 'tomoe', name: 'Tomoe', resilience: 5, text: 'Each time you successfully hit with a Weapon, draw 1 card.' },
  ushiwaka:  { id: 'ushiwaka', name: 'Ushiwaka', resilience: 4, text: 'Each time you suffer a wound from a Weapon, draw 1 card per wound.' },
}

export const ROLES: Record<RoleId, RoleDef> = {
  shogun:   { id: 'shogun', team: 'shogun', name: 'Shogun' },
  samurai1: { id: 'samurai1', team: 'shogun', name: 'Samurai' },
  samurai2: { id: 'samurai2', team: 'shogun', name: 'Samurai' },
  ninja1:   { id: 'ninja1', team: 'ninja', name: 'Ninja', stars: 1 },
  ninja2:   { id: 'ninja2', team: 'ninja', name: 'Ninja', stars: 2 },
  ninja3:   { id: 'ninja3', team: 'ninja', name: 'Ninja', stars: 3 },
  ronin:    { id: 'ronin', team: 'ronin', name: 'Rōnin' },
}

/** Role sets by player count (3p is the special variant). Ninjas are drawn randomly from the three star-cards. */
export const ROLE_SETS: Record<number, { fixed: RoleId[]; ninjas: number }> = {
  3: { fixed: ['shogun'], ninjas: 2 },
  4: { fixed: ['shogun', 'samurai1'], ninjas: 2 },
  5: { fixed: ['shogun', 'samurai1', 'ronin'], ninjas: 2 },
  6: { fixed: ['shogun', 'samurai1', 'ronin'], ninjas: 3 },
  7: { fixed: ['shogun', 'samurai1', 'samurai2', 'ronin'], ninjas: 3 },
}

/** Score multiplier for a role at a given player count. `mostStarredNinja` matters only at 4p. */
export function roleMultiplier(role: RoleId, playerCount: number, mostStarredNinja: boolean): number {
  const team = ROLES[role].team
  if (team === 'shogun') {
    if (playerCount === 3) return role === 'shogun' ? 2 : 1
    if (playerCount === 4) return role === 'shogun' ? 1 : 2
    if (playerCount === 6) return role === 'shogun' ? 1 : 2
    return 1 // 5p, 7p
  }
  if (team === 'ninja') {
    if (playerCount === 4 && mostStarredNinja) return 2
    return 1
  }
  // ronin
  if (playerCount === 5) return 2
  return 3 // 6p, 7p
}

/** Build the full 90-card deck (unshuffled). */
export function buildDeck(): Card[] {
  const deck: Card[] = []
  let id = 0
  for (const def of Object.values(CARD_DEFS)) {
    for (let i = 0; i < def.count; i++) deck.push({ id: id++, kind: def.kind })
  }
  return deck
}

export function cardDef(card: Card | CardKind): CardDef {
  return CARD_DEFS[typeof card === 'string' ? card : card.kind]
}

export function isWeapon(card: Card): boolean {
  return cardDef(card).type === 'weapon'
}

/** Initial hand size by clockwise position from the Shogun (position 0). */
export function initialHandSize(posFromShogun: number): number {
  return [4, 5, 5, 6, 6, 7, 7][posFromShogun]
}
